import { useEffect, useMemo, useState } from 'react'
import type { RunEvent, RunInfo } from '@shared/types'
import { api } from '@/lib/api'
import { deriveViews } from '@/lib/run-views'

export type { ActivityItem, ChatItem, StepStatus } from '@/lib/run-views'
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
