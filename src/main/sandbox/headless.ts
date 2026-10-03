import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import type { ScenarioId } from '@shared/scenarios'
import { openDatabase, type Database } from '../db/client'
import { PlaywrightDriver } from '../browser/playwright-driver'
import type { BrowserDriver } from '../browser/driver'
import { createPortal, listen, type Portal, type RunningServer } from '../portal/server'
import type { SandboxEnv } from '../agent/runtime'
import { Faults, type FaultConfig } from './faults'
import { buildSandbox } from './seed'

export interface HeadlessSandbox {
  database: Database
  filesDir: string
  faults: Faults
  portal: Portal
  server: RunningServer
  driver: BrowserDriver
  env: SandboxEnv
  close(): Promise<void>
}

/**
 * A complete, isolated sandbox with no UI: in-memory PGlite, a temp Files folder, the portal on a
 * free port and (lazily) headless Chromium. Used by `pnpm eval` and the tests.
 */
export async function createHeadlessSandbox(scenario: ScenarioId, opts: { faults?: Partial<FaultConfig> } = {}): Promise<HeadlessSandbox> {
  const database = await openDatabase()
  const filesDir = await mkdtemp(join(tmpdir(), 'arcus-sandbox-'))
  await buildSandbox({ pg: database.pg, db: database.db, filesDir }, scenario)
  const faults = new Faults(scenario, opts.faults ?? {})
  const portal = createPortal({ getDb: () => database.db, getFaults: () => faults })
  const server = await listen(portal.app)

  let browser: Browser | null = null
  let page: Page | null = null
  const driver = new PlaywrightDriver(async () => {
    if (!page) {
      browser = await chromium.launch({ headless: true })
      page = await (await browser.newContext()).newPage()
    }
    return page
  })

  const env: SandboxEnv = {
    db: database.db,
    filesDir,
    faults,
    browser: driver,
    portalUrl: server.url,
    scenario,
    sandboxChanged: () => undefined,
  }

  return {
    database,
    filesDir,
    faults,
    portal,
    server,
    driver,
    env,
    async close() {
      await (browser as Browser | null)?.close().catch(() => undefined)
      await server.close()
      await database.close()
      await rm(filesDir, { recursive: true, force: true })
    },
  }
}
