import { desc, eq } from 'drizzle-orm'
import type { RunInfo } from '@shared/types'
import type { Db } from '../db/client'
import { runs } from '../db/schema'

export type RunState = typeof runs.$inferSelect

export class RunStore {
  constructor(private readonly db: Db) {}

  async create(state: Omit<RunState, 'createdAt' | 'updatedAt' | 'worklist'>): Promise<RunState> {
    const [row] = await this.db.insert(runs).values(state).returning()
    return row!
  }

  async load(id: string): Promise<RunState | null> {
    const [row] = await this.db.select().from(runs).where(eq(runs.id, id))
    return row ?? null
  }

  /** Persists the whole run. Called after every step. */
  async save(state: RunState): Promise<void> {
    state.updatedAt = new Date().toISOString()
    const { id, createdAt: _createdAt, ...rest } = state
    await this.db.update(runs).set(rest).where(eq(runs.id, id))
  }

  async list(limit = 50): Promise<RunInfo[]> {
    const rows = await this.db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit)
    return rows.map(toInfo)
  }

  async findActive(): Promise<RunState[]> {
    const rows = await this.db.select().from(runs).orderBy(desc(runs.createdAt)).limit(20)
    return rows.filter((r) => r.status === 'running' || r.status === 'awaiting_user')
  }
}

export function toInfo(r: RunState): RunInfo {
  return {
    id: r.id,
    goal: r.goal,
    scenario: r.scenario,
    status: r.status,
    stepCount: r.stepCount,
    pending: r.pending ?? null,
    worklist: r.worklist ?? [],
    summary: r.summary,
    verification: r.verification ?? null,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}
