import type { BrowserWindow } from 'electron'
import type { IpcPushes, IpcPushChannel } from '@shared/ipc'
import { isScenario, type ScenarioId } from '@shared/scenarios'
import type { AppState } from '@shared/types'
import { AgentRuntime } from '../agent/runtime'
import { EventLog } from '../agent/events'
import { RunStore } from '../agent/store'
import { PlaywrightDriver } from '../browser/playwright-driver'
import type { BrowserDriver } from '../browser/driver'
import { createRouter, loadLLMConfig } from '../config'
import { openDatabase, type Database } from '../db/client'
import { sandboxMeta, vendors } from '../db/schema'
import type { LLMRouter } from '../llm/router'
import type { DataPaths } from '../paths'
import { CAPTCHA_COOKIE, createPortal, listen, type Portal, type RunningServer } from '../portal/server'
import { Faults } from '../sandbox/faults'
import { buildSandbox, SANDBOX_SCHEMA_VERSION } from '../sandbox/seed'
import { createRegistry } from '../tools/registry'
import { PortalView } from './portal-view'
import { SettingsStore } from './settings'

const PREFERRED_PORTAL_PORT = 4517

/** Owns the sandbox, the portal server and the agent runtime for the desktop app. */
export class AppController {
  database!: Database
  runtime!: AgentRuntime
  events!: EventLog
  store!: RunStore
  portalView!: PortalView
  browser!: BrowserDriver
  private server!: RunningServer
  private portal!: Portal
  private faults!: Faults
  private scenario: ScenarioId = 'happy_path'
  private settings: SettingsStore
  private router: LLMRouter | null = null
  private interruptedRunId: string | null = null

  constructor(
    private readonly paths: DataPaths,
    private readonly settingsDir: string,
    private readonly win: BrowserWindow,
  ) {
    this.settings = new SettingsStore(settingsDir)
  }

  async init(): Promise<void> {
    this.database = await openDatabase(this.paths.dbDir)
    const db = this.database.db
    const meta = Object.fromEntries((await db.select().from(sandboxMeta).catch(() => [])).map((m) => [m.key, m.value]))
    const hasVendors = await db
      .select({ id: vendors.id })
      .from(vendors)
      .limit(1)
      .then((r) => r.length > 0)
      .catch(() => false)
    this.scenario = isScenario(meta.scenario) ? meta.scenario : 'happy_path'
    if (!hasVendors || meta.schemaVersion !== SANDBOX_SCHEMA_VERSION) await this.seed(this.scenario)
    this.faults = new Faults(this.scenario)

    this.portal = createPortal({ getDb: () => this.database.db, getFaults: () => this.faults })
    this.server = await listen(this.portal.app, PREFERRED_PORTAL_PORT)
    this.portalView = new PortalView(this.win, this.server.url)
    if (process.env.ARCUS_E2E === '1') this.exposeE2EHooks()
    const driver = new PlaywrightDriver(() => this.portalView.getPage())
    this.browser = driver

    this.store = new RunStore(db)
    this.events = new EventLog(db)
    this.events.subscribe((e) => this.push('run:event', e))
    this.runtime = new AgentRuntime({
      store: this.store,
      events: this.events,
      registry: createRegistry(),
      router: () => this.getRouter(),
      env: () => ({
        db: this.database.db,
        filesDir: this.paths.filesDir,
        faults: this.faults,
        browser: driver,
        portalUrl: this.server.url,
        scenario: this.scenario,
        sandboxChanged: (area) => this.push('sandbox:changed', { area }),
      }),
      maxSteps: loadLLMConfig().maxSteps,
      onRunUpdated: (info) => this.push('run:updated', info),
    })

    const active = await this.store.findActive()
    this.interruptedRunId = active.find((r) => r.status === 'running')?.id ?? null
  }

  async state(): Promise<AppState> {
    const cfg = loadLLMConfig()
    const active = await this.store.findActive()
    return {
      scenario: this.scenario,
      activeRunId: active[0]?.id ?? null,
      interruptedRunId: this.interruptedRunId,
      portalUrl: this.server.url,
      hasPrimaryKey: Boolean(this.settings.get('groq') ?? cfg.groqKey),
      hasFallbackKey: Boolean(this.settings.get('google') ?? cfg.googleKey),
      model: cfg.model,
      fallbackModel: cfg.fallbackModel,
    }
  }

  async assertIdle(action: string): Promise<void> {
    if ((await this.store.findActive()).length > 0) throw new Error(`Can't ${action} while a task is in progress.`)
  }

  async setScenario(scenario: ScenarioId): Promise<AppState> {
    await this.assertIdle('change the scenario')
    await this.resetTo(scenario)
    return this.state()
  }

  /** Rebuilds the sandbox and clears run history. API keys in Settings are kept. */
  async reset(): Promise<AppState> {
    await this.assertIdle('reset')
    await this.store.clearAll()
    this.events.forgetAll()
    this.interruptedRunId = null
    await this.resetTo(this.scenario)
    return this.state()
  }

  setApiKey(provider: 'groq' | 'google', key: string): void {
    this.settings.set(provider, key.trim())
    this.router = null
  }

  async resume(runId: string): Promise<void> {
    if (runId === this.interruptedRunId) this.interruptedRunId = null
    await this.runtime.resume(runId)
  }

  async dispose(): Promise<void> {
    await this.portalView?.dispose()
    await this.server?.close()
    await this.database?.close()
  }

  /**
   * Test-only (ARCUS_E2E=1): lets scripts/live-run.ts answer the captcha like a human reading it.
   * Never enabled in normal runs; the answer still goes through the same chat form as a user's.
   */
  private exposeE2EHooks(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    ;(globalThis as Record<string, unknown>).__arcusE2E = {
      get browser() {
        return self.browser
      },
      captchaAnswer: async () => {
        const [cookie] = await this.portalView.view.webContents.session.cookies.get({ name: CAPTCHA_COOKIE })
        return cookie ? this.portal.captchaAnswer(cookie.value) : null
      },
    }
  }

  private async resetTo(scenario: ScenarioId): Promise<void> {
    await this.seed(scenario)
    this.scenario = scenario
    this.faults = new Faults(scenario)
    this.portal.clearState()
    await this.portalView.clearSession()
    this.push('sandbox:changed', { area: 'all' })
  }

  private async seed(scenario: ScenarioId): Promise<void> {
    await buildSandbox({ pg: this.database.pg, db: this.database.db, filesDir: this.paths.filesDir }, scenario)
  }

  private getRouter(): LLMRouter {
    if (!this.router) {
      const cfg = loadLLMConfig()
      this.router = createRouter({ ...cfg, groqKey: this.settings.get('groq') ?? cfg.groqKey, googleKey: this.settings.get('google') ?? cfg.googleKey })
    }
    return this.router
  }

  push<C extends IpcPushChannel>(channel: C, payload: IpcPushes[C]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }
}
