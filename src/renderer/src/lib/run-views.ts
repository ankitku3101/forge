import type { FocusTarget, PendingRequest, Risk, RunEvent, ToolErrorCode, VerificationResult, WorkItem } from '@shared/types'

/** Pure folding of a run's event stream into what the panels show. No Electron or React here, so it is testable. */
export type StepStatus = 'running' | 'ok' | 'error' | 'waiting' | 'stopped'

export type ActivityItem =
  | {
      kind: 'step'
      id: string
      step: number
      tool: string
      input: unknown
      risk: Risk
      model?: string
      status: StepStatus
      output?: unknown
      error?: { code: ToolErrorCode; message: string }
      retries: { attempt: number; message: string }[]
      waitingFor?: PendingRequest['kind']
      policy?: { decision: 'auto' | 'approval' | 'deny'; reason: string; warning: string | null }
      response?: string
      durationMs?: number
      at: string
    }
  | { kind: 'note'; id: string; text: string; at: string }
  | { kind: 'fallback'; id: string; from: string; to: string; reason: string; at: string }
  | { kind: 'security'; id: string; tool: string; snippets: string[]; at: string }
  | { kind: 'verification'; id: string; result: VerificationResult; at: string }
  | { kind: 'end'; id: string; ok: boolean; text: string; at: string }

export type ChatItem =
  | { kind: 'task'; id: string; text: string }
  | { kind: 'worker'; id: string; text: string }
  | { kind: 'user'; id: string; text: string }
  | { kind: 'summary'; id: string; text: string; verification: VerificationResult; usedFallback: boolean }
  | { kind: 'failure'; id: string; text: string }

/** Folds the run's event stream into the Activity feed and the Chat transcript. */
export function deriveViews(events: RunEvent[]) {
  const activity: ActivityItem[] = []
  const chat: ChatItem[] = []
  const steps = new Map<string, Extract<ActivityItem, { kind: 'step' }>>()
  let model: string | undefined
  let lastWaiting: Extract<ActivityItem, { kind: 'step' }> | undefined
  let focus: FocusTarget | null = null
  let worklist: WorkItem[] = []

  for (const e of events) {
    const id = `${e.runId}:${e.seq}`
    switch (e.type) {
      case 'task_started':
        chat.push({ kind: 'task', id, text: e.goal })
        break
      case 'step_started':
        model = e.model
        break
      case 'model_note':
        activity.push({ kind: 'note', id, text: e.text, at: e.at })
        break
      case 'llm_waiting':
        activity.push({ kind: 'note', id, text: `Waiting ${Math.round(e.ms / 1000)}s: ${e.reason} (attempt ${e.attempt}).`, at: e.at })
        break
      case 'llm_fallback':
        activity.push({ kind: 'fallback', id, from: e.from, to: e.to, reason: e.reason, at: e.at })
        break
      case 'tool_called': {
        const item = { kind: 'step' as const, id: e.toolCallId, step: e.step, tool: e.tool, input: e.input, risk: e.risk, model, status: 'running' as StepStatus, retries: [], at: e.at }
        steps.set(e.toolCallId, item)
        activity.push(item)
        break
      }
      case 'worklist_updated':
        worklist = e.items
        break
      case 'injection_detected':
        activity.push({ kind: 'security', id, tool: e.tool, snippets: e.snippets, at: e.at })
        break
      case 'policy_decision': {
        const s = steps.get(e.toolCallId)
        if (s) s.policy = { decision: e.decision, reason: e.reason, warning: e.warning }
        break
      }
      case 'tool_retry':
        steps.get(e.toolCallId)?.retries.push({ attempt: e.attempt, message: e.message })
        break
      case 'tool_succeeded': {
        const s = steps.get(e.toolCallId)
        if (s) Object.assign(s, { status: 'ok', output: e.output, durationMs: e.durationMs, waitingFor: undefined })
        break
      }
      case 'tool_failed': {
        const s = steps.get(e.toolCallId)
        if (s) Object.assign(s, { status: 'error', error: { code: e.code, message: e.message }, durationMs: e.durationMs, waitingFor: undefined })
        break
      }
      case 'approval_requested':
      case 'input_requested': {
        const s = steps.get(e.request.toolCallId)
        if (s) {
          s.status = 'waiting'
          s.waitingFor = e.request.kind
          lastWaiting = s
        }
        chat.push({ kind: 'worker', id, text: requestText(e.request) })
        break
      }
      case 'user_responded':
        if (lastWaiting) {
          lastWaiting.response = e.summary
          lastWaiting.status = 'running'
        }
        chat.push({ kind: 'user', id, text: e.summary })
        break
      case 'focus_changed':
        focus = e.focus
        break
      case 'verification_passed':
      case 'verification_failed':
        activity.push({ kind: 'verification', id, result: e.result, at: e.at })
        break
      case 'task_completed':
        settleOpenSteps(steps, 'ok')
        activity.push({ kind: 'end', id, ok: true, text: 'Task completed', at: e.at })
        chat.push({ kind: 'summary', id, text: e.summary, verification: e.verification, usedFallback: e.usedFallback })
        break
      case 'task_failed':
        settleOpenSteps(steps, 'stopped')
        activity.push({ kind: 'end', id, ok: false, text: e.reason, at: e.at })
        chat.push({ kind: 'failure', id, text: e.reason })
        break
      case 'status_changed':
        break
    }
  }
  return { activity, chat, focus, worklist }
}

/**
 * A finished run has no steps in flight. Steps still open when it ended (e.g. the final `finish`,
 * or a step interrupted by Stop) are settled so nothing keeps spinning.
 */
function settleOpenSteps(steps: Map<string, Extract<ActivityItem, { kind: 'step' }>>, to: 'ok' | 'stopped'): void {
  for (const s of steps.values()) {
    if (s.status === 'running' || s.status === 'waiting') {
      s.status = to
      s.waitingFor = undefined
    }
  }
}

function requestText(r: PendingRequest): string {
  switch (r.kind) {
    case 'approval':
      return `I need your approval: ${r.title}.`
    case 'question':
      return r.question
    case 'credentials':
      return `Please sign me in to ${r.site}. I won't see your password.`
    case 'captcha':
      return 'Please solve the captcha on the sign-in page.'
  }
}

