import { useEffect, useMemo, useState } from 'react'
import type {
  FocusTarget,
  PendingRequest,
  Risk,
  RunEvent,
  RunInfo,
  ToolErrorCode,
  VerificationResult,
} from '@shared/types'
import { api } from '@/lib/api'

export type StepStatus = 'running' | 'ok' | 'error' | 'waiting'

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
      case 'llm_fallback':
        activity.push({ kind: 'fallback', id, from: e.from, to: e.to, reason: e.reason, at: e.at })
        break
      case 'tool_called': {
        const item = { kind: 'step' as const, id: e.toolCallId, step: e.step, tool: e.tool, input: e.input, risk: e.risk, model, status: 'running' as StepStatus, retries: [], at: e.at }
        steps.set(e.toolCallId, item)
        activity.push(item)
        break
      }
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
        activity.push({ kind: 'end', id, ok: true, text: 'Task completed', at: e.at })
        chat.push({ kind: 'summary', id, text: e.summary, verification: e.verification, usedFallback: e.usedFallback })
        break
      case 'task_failed':
        activity.push({ kind: 'end', id, ok: false, text: e.reason, at: e.at })
        chat.push({ kind: 'failure', id, text: e.reason })
        break
      case 'status_changed':
        break
    }
  }
  return { activity, chat, focus }
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

/** Live view of one run: its info plus its full event history, kept in sync with main-process pushes. */
export function useRun(runId: string | null) {
  // State is tagged with the run it belongs to, so switching runs never shows stale data.
  const [info, setInfo] = useState<{ runId: string; value: RunInfo | null } | null>(null)
  const [events, setEvents] = useState<{ runId: string; list: RunEvent[] } | null>(null)

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    const addEvents = (more: RunEvent[]) =>
      setEvents((prev) => ({ runId, list: mergeEvents(prev?.runId === runId ? prev.list : [], more) }))
    void Promise.all([api.invoke('run:events', { runId }), api.invoke('run:list')]).then(([evs, runs]) => {
      if (cancelled) return
      addEvents(evs)
      setInfo((prev) => (prev?.runId === runId ? prev : { runId, value: runs.find((r) => r.id === runId) ?? null }))
    })
    const offEvent = api.on('run:event', (e) => {
      if (e.runId === runId) addEvents([e])
    })
    const offInfo = api.on('run:updated', (r) => {
      if (r.id === runId) setInfo({ runId, value: r })
    })
    return () => {
      cancelled = true
      offEvent()
      offInfo()
    }
  }, [runId])

  const list = useMemo(() => (events && events.runId === runId ? events.list : []), [events, runId])
  const views = useMemo(() => deriveViews(list), [list])
  return { info: info && info.runId === runId ? info.value : null, events: list, ...views }
}

function mergeEvents(a: RunEvent[], b: RunEvent[]): RunEvent[] {
  const bySeq = new Map<number, RunEvent>()
  for (const e of [...a, ...b]) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq)
}
