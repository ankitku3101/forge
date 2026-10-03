import { asc, eq, max } from 'drizzle-orm'
import type { RunEvent, RunEventPayload } from '@shared/types'
import type { Db } from '../db/client'
import { runEvents } from '../db/schema'

export type EventListener = (e: RunEvent) => void

/** Every state change becomes a structured event: persisted first, then pushed to listeners. */
export class EventLog {
  private readonly seqs = new Map<string, number>()
  private readonly listeners = new Set<EventListener>()

  constructor(private readonly db: Db) {}

  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async emit(runId: string, payload: RunEventPayload): Promise<RunEvent> {
    const seq = (await this.nextSeq(runId)) + 1
    this.seqs.set(runId, seq)
    const at = new Date().toISOString()
    await this.db.insert(runEvents).values({ runId, seq, type: payload.type, data: payload, at })
    const event = { runId, seq, at, ...payload } as RunEvent
    for (const fn of this.listeners) {
      try {
        fn(event)
      } catch (err) {
        console.error('[events] listener failed', err)
      }
    }
    return event
  }

  /** Forgets cached sequence numbers after run history is cleared. */
  forgetAll(): void {
    this.seqs.clear()
  }

  async list(runId: string): Promise<RunEvent[]> {
    const rows = await this.db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.seq))
    return rows.map((r) => ({ runId: r.runId, seq: r.seq, at: r.at, ...r.data }) as RunEvent)
  }

  private async nextSeq(runId: string): Promise<number> {
    const cached = this.seqs.get(runId)
    if (cached !== undefined) return cached
    const [row] = await this.db.select({ m: max(runEvents.seq) }).from(runEvents).where(eq(runEvents.runId, runId))
    return row?.m ?? 0
  }
}
