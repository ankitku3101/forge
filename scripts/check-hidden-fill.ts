/**
 * Dev aid: reproduces "worker fills the sign-in form while the portal view is hidden".
 * `pnpm build:app && pnpm tsx scripts/check-hidden-fill.ts`
 */
import { _electron as electron } from 'playwright'

const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
const app = await electron.launch({ args: ['.'], env: { ...(env as Record<string, string>), ARCUS_E2E: '1' } })
type Hooks = { __arcusE2E: { browser: { open(u: string): Promise<unknown>; fillLogin(u: string, p: string): Promise<void>; snapshot(): Promise<{ text: string }> } } }
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=Arcus sandbox', { timeout: 30_000 })
  const state = await win.evaluate(() => window.arcus.invoke('app:state'))
  if (process.argv.includes('--hide')) await win.evaluate(() => window.arcus.invoke('portal:setBounds', { bounds: null }))
  // Portal view is hidden: the Workspace shows nothing, as when the user is looking at a file.
  const visible = await app.evaluate(({ BrowserWindow, WebContentsView }) =>
    (BrowserWindow.getAllWindows()[0]!.contentView.children.find((c) => c instanceof WebContentsView) as InstanceType<typeof WebContentsView>).getVisible(),
  )
  console.log('portal view visible:', visible)
  const started = Date.now()
  const result = await app.evaluate(
    async (_e, url) => {
      const b = (globalThis as unknown as Hooks).__arcusE2E.browser
      try {
        await b.open(`${url}/login`)
        await b.fillLogin('demo', 'demo123')
        return 'filled: ' + (await b.snapshot()).text.split('\n').filter((l) => /Username|Password/.test(l)).join(' | ')
      } catch (e) {
        return 'FAILED: ' + (e as Error).message.split('\n')[0]
      }
    },
    state.portalUrl,
  )
  console.log(`${result} (${Date.now() - started} ms)`)
} finally {
  await app.close()
}
