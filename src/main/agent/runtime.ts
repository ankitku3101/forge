import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { ScenarioId } from '@shared/scenarios'
import type { FocusTarget, PendingRequest, RunInfo, RunStatus, ToolErrorCode, UserResponse } from '@shared/types'
import type { Db } from '../db/client'
import type { BrowserDriver } from '../browser/driver'
import type { Faults } from '../sandbox/faults'
import { LLMError, type ChatMessage, type CompletionResult, type ToolCall } from '../llm/types'
import type { LLMRouter } from '../llm/router'
import type { ToolRegistry } from '../tools/registry'
import { ToolFailure, type ToolContext, type ToolDefinition } from '../tools/types'
import type { finishInput } from '../tools/worker'
import type { EventLog } from './events'
import { decide, loadPolicy } from './policy'
import { systemPrompt } from './prompts/system'
import { toInfo, type RunState, type RunStore } from './store'
import { verify } from './verification'

/** The sandbox a run operates in. Supplied by the app or the eval harness. */
export interface SandboxEnv {
  db: Db
  filesDir: string
  faults: Faults
  browser: BrowserDriver
  portalUrl: string
  scenario: ScenarioId
  sandboxChanged(area: 'files' | 'mail' | 'finance'): void
}

export interface RuntimeDeps {
  store: RunStore
  events: EventLog
  registry: ToolRegistry
  router: () => LLMRouter
  env: () => SandboxEnv
  maxSteps?: number
  /** Identical failing calls allowed before the run aborts. */
  maxIdenticalFailures?: number
  sleep?: (ms: number) => Promise<void>
  today?: () => string
  onRunUpdated?: (info: RunInfo) => void
}

type Observation = { ok: true; data: unknown } | { ok: false; error: { code: ToolErrorCode; message: string } }

const MAX_OBSERVATION = 12_000
const KEEP_SNAPSHOTS = 2

export class AgentRuntime {
  private readonly active = new Map<string, AbortController>()
  private readonly loops = new Map<string, Promise<void>>()
  private readonly lastFocus = new Map<string, string>()
  private readonly maxSteps: number
  private readonly maxIdenticalFailures: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: RuntimeDeps) {
    this.maxSteps = deps.maxSteps ?? 30
    this.maxIdenticalFailures = deps.maxIdenticalFailures ?? 3
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /** Creates a run and starts its loop in the background. */
  async start(goal: string): Promise<string> {
    const env = this.deps.env()
    env.faults.reset()
    const id = randomUUID()
    const run = await this.deps.store.create({
      id,
      goal,
      scenario: env.scenario,
      status: 'running',
      messages: [{ role: 'user', content: goal }],
      facts: [],
      pending: null,
      stepCount: 0,
      writes: [],
      finishAttempts: 0,
      usedFallback: false,
      tokensIn: 0,
      tokensOut: 0,
      summary: null,
      verification: null,
      error: null,
    })
    await this.deps.events.emit(id, { type: 'task_started', goal, scenario: env.scenario })
    await this.deps.events.emit(id, { type: 'status_changed', status: 'running' })
    this.notify(run)
    this.launch(run)
    return id
  }

  /** Continues a run that was `running` when the app last stopped. */
  async resume(runId: string): Promise<void> {
    const run = await this.mustLoad(runId)
    if (run.status !== 'running' || this.loops.has(runId)) return
    this.launch(run)
  }

  /** Answers the run's pending request and continues the loop. */
  async respond(runId: string, response: UserResponse): Promise<void> {
    // The loop that paused may still be unwinding; let it finish before taking over.
    await this.loops.get(runId)
    const run = await this.mustLoad(runId)
    const pending = run.pending
    if (run.status !== 'awaiting_user' || !pending) throw new Error('This run is not waiting for input.')
    if (!compatible(pending, response)) throw new Error(`Expected a ${pending.kind} response.`)

    const call = findCall(run.messages, pending.toolCallId)
    const tool = call && this.deps.registry.get(call.name)
    if (!call || !tool) throw new Error('Pending tool call not found in history.')
    const input = tool.input.parse(parseArgs(call.arguments))

    await this.deps.events.emit(runId, { type: 'user_responded', kind: pending.kind, summary: describeResponse(response) })
    run.pending = null
    await this.setStatus(run, 'running')

    const started = Date.now()
    let obs: Observation
    if (pending.kind === 'approval') {
      obs =
        response.kind === 'approval' && response.approved
          ? await this.execute(run, tool, call.id, input)
          : fail('PERMISSION_DENIED', `The user rejected this action${response.kind === 'approval' && response.note ? `: ${response.note}` : '.'}`)
    } else if (tool.kind === 'interactive') {
      const ctx = await this.ctx(run)
      obs = await this.guard(() => tool.complete(input, response, ctx))
    } else {
      throw new Error('Pending request does not match the tool type.')
    }
    await this.observe(run, call, tool, input, obs, Date.now() - started)
    await this.save(run)
    this.launch(run)
  }

  async cancel(runId: string): Promise<void> {
    const run = await this.mustLoad(runId)
    if (run.status === 'completed' || run.status === 'failed') return
    this.active.get(runId)?.abort()
    await this.loops.get(runId)
    const fresh = await this.mustLoad(runId)
    if (fresh.status === 'completed' || fresh.status === 'failed') return
    await this.failRun(fresh, 'Cancelled by the user.')
  }

  /** Resolves when the run stops making progress on its own (waiting for the user, or finished). */
  async settle(runId: string): Promise<RunInfo> {
    for (;;) {
      const loop = this.loops.get(runId)
      if (!loop) break
      await loop
    }
    return toInfo(await this.mustLoad(runId))
  }

  // ---------------------------------------------------------------------------------------------

  private launch(run: RunState): void {
    if (this.loops.has(run.id)) return
    const controller = new AbortController()
    this.active.set(run.id, controller)
    const loop = this.loop(run, controller.signal)
      .catch(async (err) => {
        console.error('[runtime] loop crashed', err)
        await this.failRun(run, `Internal error: ${(err as Error).message}`)
      })
      .finally(() => {
        this.loops.delete(run.id)
        this.active.delete(run.id)
      })
    this.loops.set(run.id, loop)
  }

  private async loop(run: RunState, signal: AbortSignal): Promise<void> {
    while (run.status === 'running' && !signal.aborted) {
      if (run.stepCount >= this.maxSteps) {
        await this.failRun(run, `Stopped after reaching the ${this.maxSteps}-step limit.`)
        return
      }
      run.stepCount += 1
      const router = this.deps.router()

      let result: CompletionResult
      try {
        result = await router.complete(
          { messages: this.prepare(run), tools: this.deps.registry.specs(), signal },
          (r) => this.validateDecision(r),
          (n) => {
            run.usedFallback = true
            void this.deps.events.emit(run.id, { type: 'llm_fallback', from: n.from, to: n.to, reason: n.reason })
          },
        )
      } catch (err) {
        if (signal.aborted || (err instanceof LLMError && err.kind === 'aborted')) return
        if (err instanceof LLMError && err.kind === 'malformed') {
          // No fallback available: tell the model what was wrong and let it try again.
          run.messages.push({ role: 'user', content: `Your last reply was not a valid tool call (${err.message}). Reply with exactly one valid tool call.` })
          await this.save(run)
          continue
        }
        await this.failRun(run, `The model could not be reached: ${(err as Error).message}`)
        return
      }
      if (signal.aborted) return

      run.tokensIn += result.usage.input
      run.tokensOut += result.usage.output
      if (result.model !== router.primaryModel) run.usedFallback = true
      run.messages.push(result.message)
      await this.deps.events.emit(run.id, { type: 'step_started', step: run.stepCount, model: result.model, provider: result.provider })
      if (result.message.content?.trim()) {
        await this.deps.events.emit(run.id, { type: 'model_note', text: result.message.content.trim().slice(0, 2000) })
      }

      const [call, ...extra] = result.message.toolCalls ?? []
      for (const e of extra) {
        run.messages.push({ role: 'tool', toolCallId: e.id, name: e.name, content: JSON.stringify(fail('VALIDATION', 'Not executed: call one tool at a time.')) })
      }
      if (call) await this.handleCall(run, call)
      await this.save(run)
    }
  }

  private validateDecision(r: CompletionResult): string | null {
    const calls = r.message.toolCalls ?? []
    if (calls.length === 0) return 'no tool call'
    const first = calls[0]!
    if (!this.deps.registry.get(first.name)) return `unknown tool "${first.name}"`
    try {
      parseArgs(first.arguments)
    } catch {
      return `arguments for ${first.name} are not valid JSON`
    }
    return null
  }

  private async handleCall(run: RunState, call: ToolCall): Promise<void> {
    const tool = this.deps.registry.get(call.name)!
    const args = parseArgs(call.arguments)
    await this.deps.events.emit(run.id, { type: 'tool_called', step: run.stepCount, toolCallId: call.id, tool: tool.name, input: args, risk: tool.risk })

    const parsed = tool.input.safeParse(args)
    if (!parsed.success) {
      await this.observe(run, call, tool, args, fail('VALIDATION', formatIssues(parsed.error)))
      return
    }
    const input = parsed.data

    if (tool.kind === 'terminal') {
      await this.finish(run, call, tool, input)
      return
    }

    await this.focus(run, tool.focus?.(input))
    const ctx = await this.ctx(run)

    // Prechecks run before the policy decision, so the user is never asked to approve a doomed action.
    const pre = await this.guard(async () => {
      await tool.precheck?.(input, ctx)
      return tool.approvalAmount ? await tool.approvalAmount(input, ctx) : null
    })
    if (!pre.ok) {
      await this.observe(run, call, tool, input, pre)
      return
    }

    const { decision, reason } = decide(tool, pre.data, ctx.policy)
    if (decision !== 'auto' || tool.risk === 'financial' || ctx.policy.warning) {
      await this.deps.events.emit(run.id, { type: 'policy_decision', toolCallId: call.id, decision, reason, warning: ctx.policy.warning })
    }
    if (decision === 'deny') {
      await this.observe(run, call, tool, input, fail('PERMISSION_DENIED', `${tool.name} is not allowed: ${reason}`))
      return
    }

    if (decision === 'approval') {
      const summary = tool.approval?.(input) ?? { title: `Run ${tool.name}`, details: input as Record<string, unknown> }
      await this.pause(run, { kind: 'approval', toolCallId: call.id, tool: tool.name, ...summary, details: { ...summary.details, Policy: reason } })
      return
    }

    if (tool.kind === 'interactive') {
      const draft = await this.guard(() => tool.request(input, ctx))
      if (!draft.ok) {
        await this.observe(run, call, tool, input, draft)
        return
      }
      await this.pause(run, { ...(draft.data as Omit<PendingRequest, 'toolCallId'>), toolCallId: call.id } as PendingRequest)
      return
    }

    const started = Date.now()
    const obs = await this.execute(run, tool, call.id, input)
    await this.observe(run, call, tool, input, obs, Date.now() - started)
  }

  /** Executes an action tool, retrying TRANSIENT failures twice with backoff when its policy allows. */
  private async execute(run: RunState, tool: ToolDefinition, toolCallId: string, input: unknown): Promise<Observation> {
    if (tool.kind !== 'action') return fail('VALIDATION', `${tool.name} cannot be executed directly.`)
    const attempts = tool.retry === 'transient' ? 3 : 1
    let last: Observation = fail('TRANSIENT', 'Not attempted.')
    const ctx = await this.ctx(run)
    for (let attempt = 1; attempt <= attempts; attempt++) {
      last = await this.guard(() => tool.execute(input, ctx))
      if (last.ok || last.error.code !== 'TRANSIENT' || attempt === attempts) break
      await this.deps.events.emit(run.id, { type: 'tool_retry', toolCallId, tool: tool.name, attempt: attempt + 1, code: last.error.code, message: last.error.message })
      await this.sleep(400 * 2 ** (attempt - 1))
    }
    return last
  }

  private async guard<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: { code: ToolErrorCode; message: string } }> {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      if (err instanceof ToolFailure) return fail(err.code, err.message)
      throw err
    }
  }

  private async observe(run: RunState, call: ToolCall, tool: ToolDefinition, input: unknown, obs: Observation, durationMs = 0): Promise<void> {
    let content = JSON.stringify(obs)
    if (content.length > MAX_OBSERVATION) content = content.slice(0, MAX_OBSERVATION) + '…[truncated]'
    run.messages.push({ role: 'tool', toolCallId: call.id, name: tool.name, content })

    if (obs.ok) {
      await this.deps.events.emit(run.id, { type: 'tool_succeeded', toolCallId: call.id, tool: tool.name, output: obs.data, durationMs })
      await this.focus(run, tool.focus?.(input as never, obs.data as never))
      return
    }
    await this.deps.events.emit(run.id, { type: 'tool_failed', toolCallId: call.id, tool: tool.name, code: obs.error.code, message: obs.error.message, durationMs })
    if (this.identicalFailures(run, call) >= this.maxIdenticalFailures) {
      await this.failRun(run, `Aborted: ${tool.name} failed ${this.maxIdenticalFailures} times with the same input (${obs.error.code}).`)
    }
  }

  /** Counts failed calls in history with the same tool and arguments. Derived from persisted state, so it survives restarts. */
  private identicalFailures(run: RunState, call: ToolCall): number {
    const key = `${call.name}:${canonical(call.arguments)}`
    const failed = new Set(
      run.messages.filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool' && m.content.startsWith('{"ok":false')).map((m) => m.toolCallId),
    )
    let count = 0
    for (const m of run.messages) {
      if (m.role !== 'assistant') continue
      for (const tc of m.toolCalls ?? []) {
        if (failed.has(tc.id) && `${tc.name}:${canonical(tc.arguments)}` === key) count += 1
      }
    }
    return count
  }

  private async finish(run: RunState, call: ToolCall, tool: ToolDefinition, input: unknown): Promise<void> {
    const { summary, claims, outcome } = input as z.output<typeof finishInput>
    const env = this.deps.env()
    run.finishAttempts += 1
    const result = await verify({ db: env.db, filesDir: env.filesDir, scenario: run.scenario, writes: run.writes, claims })
    run.verification = result

    if (result.status === 'mismatch') {
      await this.deps.events.emit(run.id, { type: 'verification_failed', result })
      const problems = result.checks.filter((c) => c.status === 'mismatch').map((c) => `${c.target}: ${c.detail}`)
      if (run.finishAttempts < 2) {
        await this.observe(
          run,
          call,
          tool,
          input,
          fail('VALIDATION', `Not accepted. Independent verification found mismatches: ${problems.join(' | ')}. Fix them if you can, otherwise call finish again and report the mismatch.`),
        )
        return
      }
      run.messages.push({ role: 'tool', toolCallId: call.id, name: tool.name, content: JSON.stringify({ ok: true, data: { accepted: false, verification: result.status } }) })
      run.summary = withFallbackNote(run, summary)
      await this.failRun(run, `Verification mismatch: ${problems.join(' | ')}`)
      return
    }

    run.messages.push({ role: 'tool', toolCallId: call.id, name: tool.name, content: JSON.stringify({ ok: true, data: { accepted: true, verification: result.status } }) })
    if (result.status === 'verified') await this.deps.events.emit(run.id, { type: 'verification_passed', result })
    run.summary = withFallbackNote(run, summary)
    if (outcome === 'blocked') {
      await this.failRun(run, 'The worker could not complete the task (see summary).')
      return
    }
    await this.setStatus(run, 'completed')
    await this.deps.events.emit(run.id, { type: 'task_completed', summary: run.summary, verification: result, usedFallback: run.usedFallback })
    await this.save(run)
  }

  private async pause(run: RunState, request: PendingRequest): Promise<void> {
    run.pending = request
    await this.deps.events.emit(run.id, { type: request.kind === 'approval' ? 'approval_requested' : 'input_requested', request })
    await this.setStatus(run, 'awaiting_user')
  }

  private async setStatus(run: RunState, status: RunStatus): Promise<void> {
    if (run.status === status) return
    run.status = status
    await this.deps.events.emit(run.id, { type: 'status_changed', status })
    await this.save(run)
  }

  private async failRun(run: RunState, reason: string): Promise<void> {
    run.error = reason
    run.pending = null
    await this.setStatus(run, 'failed')
    await this.deps.events.emit(run.id, { type: 'task_failed', reason })
    await this.save(run)
  }

  private async focus(run: RunState, target: FocusTarget | undefined): Promise<void> {
    if (!target) return
    const key = JSON.stringify(target)
    if (this.lastFocus.get(run.id) === key) return
    this.lastFocus.set(run.id, key)
    await this.deps.events.emit(run.id, { type: 'focus_changed', focus: target })
  }

  private async save(run: RunState): Promise<void> {
    await this.deps.store.save(run)
    this.notify(run)
  }

  private notify(run: RunState): void {
    this.deps.onRunUpdated?.(toInfo(run))
  }

  private async mustLoad(runId: string): Promise<RunState> {
    const run = await this.deps.store.load(runId)
    if (!run) throw new Error(`Run ${runId} not found.`)
    return run
  }

  private async ctx(run: RunState): Promise<ToolContext> {
    const env = this.deps.env()
    return {
      policy: await loadPolicy(env.filesDir),
      db: env.db,
      filesDir: env.filesDir,
      faults: env.faults,
      browser: env.browser,
      portalUrl: env.portalUrl,
      runId: run.id,
      scenario: run.scenario,
      facts: run.facts,
      writes: run.writes,
      sandboxChanged: env.sandboxChanged,
    }
  }

  /** Builds the model's context: system prompt with working memory, and history with stale page snapshots elided. */
  private prepare(run: RunState): ChatMessage[] {
    const env = this.deps.env()
    const today = this.deps.today?.() ?? new Date().toISOString().slice(0, 10)
    const snapshotIdx: number[] = []
    run.messages.forEach((m, i) => {
      if (m.role === 'tool' && m.content.includes('"snapshot":')) snapshotIdx.push(i)
    })
    const stale = new Set(snapshotIdx.slice(0, Math.max(0, snapshotIdx.length - KEEP_SNAPSHOTS)))
    const history = run.messages.map((m, i) => {
      if (!stale.has(i) || m.role !== 'tool') return m
      try {
        const obs = JSON.parse(m.content) as { ok: boolean; data?: Record<string, unknown> }
        if (obs.data) obs.data.snapshot = '[older page snapshot omitted]'
        return { ...m, content: JSON.stringify(obs) }
      } catch {
        return m
      }
    })
    return [{ role: 'system', content: systemPrompt({ today, portalUrl: env.portalUrl, facts: run.facts }) }, ...history]
  }
}

function fail(code: ToolErrorCode, message: string): { ok: false; error: { code: ToolErrorCode; message: string } } {
  return { ok: false, error: { code, message } }
}

function parseArgs(raw: string): unknown {
  return raw.trim() === '' ? {} : JSON.parse(raw)
}

function canonical(raw: string): string {
  try {
    return JSON.stringify(sortKeys(parseArgs(raw)))
  } catch {
    return raw
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]))
  }
  return v
}

function formatIssues(err: z.ZodError): string {
  return 'Invalid input: ' + err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

function findCall(messages: ChatMessage[], toolCallId: string): ToolCall | undefined {
  for (const m of messages) {
    if (m.role === 'assistant') {
      const tc = m.toolCalls?.find((t) => t.id === toolCallId)
      if (tc) return tc
    }
  }
  return undefined
}

function compatible(pending: PendingRequest, response: UserResponse): boolean {
  switch (pending.kind) {
    case 'approval':
      return response.kind === 'approval'
    case 'question':
      return response.kind === 'answer'
    case 'credentials':
      return response.kind === 'credentials' || response.kind === 'done_in_page'
    case 'captcha':
      return response.kind === 'captcha' || response.kind === 'done_in_page'
  }
}

/** Event-safe description of a user response. Secrets are never included. */
function describeResponse(r: UserResponse): string {
  switch (r.kind) {
    case 'approval':
      return r.approved ? 'Approved' : `Rejected${r.note ? `: ${r.note}` : ''}`
    case 'answer':
      return r.text
    case 'credentials':
      return 'Credentials provided'
    case 'captcha':
      return 'Captcha answer provided'
    case 'done_in_page':
      return 'Entered directly in the portal page'
  }
}

function withFallbackNote(run: RunState, summary: string): string {
  return run.usedFallback ? `${summary}\n\n(Part of this run was decided by the fallback model.)` : summary
}
