import { describe, expect, it } from 'vitest'
import { deriveViews } from '../src/renderer/src/lib/run-views'
import type { RunEvent, RunEventPayload } from '../src/shared/types'

let seq = 0
const ev = (p: RunEventPayload): RunEvent => ({ runId: 'r', seq: ++seq, at: '2026-10-04T00:00:00Z', ...p }) as RunEvent
const called = (id: string, tool: string): RunEventPayload => ({ type: 'tool_called', step: 1, toolCallId: id, tool, input: {}, risk: 'read' })
const verification = { status: 'verified' as const, checks: [] }

describe('activity view', () => {
  it('settles a finish step that never got its own result event (older runs)', () => {
    const { activity } = deriveViews([
      ev(called('a', 'read_file')),
      ev({ type: 'tool_succeeded', toolCallId: 'a', tool: 'read_file', output: {}, durationMs: 1 }),
      ev(called('b', 'finish')),
      ev({ type: 'task_completed', summary: 'done', verification, usedFallback: false }),
    ])
    const steps = activity.filter((i) => i.kind === 'step')
    expect(steps.map((s) => s.kind === 'step' && s.status)).toEqual(['ok', 'ok'])
  })

  it('marks steps cut off by a failure or Stop as stopped, not running', () => {
    const { activity } = deriveViews([
      ev(called('a', 'browser_open')),
      ev(called('b', 'create_record')),
      ev({ type: 'approval_requested', request: { kind: 'approval', toolCallId: 'b', tool: 'create_record', title: 't', details: {} } }),
      ev({ type: 'task_failed', reason: 'Cancelled by the user.' }),
    ])
    const steps = activity.flatMap((i) => (i.kind === 'step' ? [i] : []))
    expect(steps.map((s) => [s.status, s.waitingFor])).toEqual([
      ['stopped', undefined],
      ['stopped', undefined],
    ])
  })
})
