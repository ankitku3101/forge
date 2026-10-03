import { mkdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import * as schema from './schema'
import { DROP_SANDBOX, RUNS_DDL, SANDBOX_DDL } from './ddl'

export type Db = PgliteDatabase<typeof schema>

export interface Database {
  db: Db
  pg: PGlite
  close(): Promise<void>
}

/** Opens PGlite at `dataDir`, or in memory when omitted, and ensures all tables exist. */
export async function openDatabase(dataDir?: string): Promise<Database> {
  if (dataDir) await mkdir(dataDir, { recursive: true })
  const pg = dataDir ? await PGlite.create(dataDir) : await PGlite.create()
  await pg.exec(SANDBOX_DDL)
  await pg.exec(RUNS_DDL)
  const db = drizzle({ client: pg, schema })
  return { db, pg, close: () => pg.close() }
}

export async function recreateSandboxTables(pg: PGlite): Promise<void> {
  await pg.exec(DROP_SANDBOX)
  await pg.exec(SANDBOX_DDL)
}
