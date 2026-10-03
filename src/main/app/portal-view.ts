import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, WebContentsView, type BrowserWindow, type Rectangle } from 'electron'
import { chromium, type Browser, type Page } from 'playwright-core'

/**
 * The live portal page shown in the Workspace. It is a real Chromium view; the worker drives it
 * through Playwright over CDP, so the user watches exactly what the worker does and can also type
 * into it directly.
 */
export class PortalView {
  readonly view: WebContentsView
  private cdp: Browser | null = null
  private page: Page | null = null

  constructor(
    private readonly win: BrowserWindow,
    private readonly portalUrl: string,
  ) {
    this.view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } })
    this.view.setVisible(false)
    win.contentView.addChildView(this.view)
    void this.view.webContents.loadURL(`${portalUrl}/login`)
    // Keep navigation inside the portal.
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  setBounds(bounds: Rectangle | null): void {
    if (!bounds || bounds.width < 2 || bounds.height < 2) {
      this.view.setVisible(false)
      return
    }
    this.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) })
    this.view.setVisible(true)
  }

  async clearSession(): Promise<void> {
    await this.view.webContents.session.clearStorageData({ storages: ['cookies'] })
    await this.view.webContents.loadURL(`${this.portalUrl}/login`).catch(() => undefined)
  }

  /** The Playwright page for this view, attached over CDP on first use. */
  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page
    if (!this.cdp?.isConnected()) {
      const port = await devToolsPort()
      this.cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    }
    const origin = new URL(this.portalUrl).origin
    const target = this.view.webContents.getURL()
    for (let attempt = 0; attempt < 20; attempt++) {
      const pages = this.cdp.contexts().flatMap((c) => c.pages())
      const found = pages.find((p) => p.url() === target) ?? pages.find((p) => p.url().startsWith(origin))
      if (found) {
        this.page = found
        return found
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error('Could not attach to the portal view over CDP.')
  }

  async dispose(): Promise<void> {
    await this.cdp?.close().catch(() => undefined)
    this.win.contentView.removeChildView(this.view)
    this.view.webContents.close()
  }
}

/** Chromium writes the chosen debugging port here when started with --remote-debugging-port=0. */
async function devToolsPort(): Promise<number> {
  const file = join(app.getPath('userData'), 'DevToolsActivePort')
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const port = Number((await readFile(file, 'utf8')).split('\n')[0])
      if (port > 0) return port
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Remote debugging port is not available.')
}
