/**
 * Dev aid: launches the built app (`pnpm build:app` first), walks the main views in light and dark
 * mode, attaches to the portal view over CDP, and saves screenshots. `pnpm tsx scripts/smoke-app.ts <outDir>`
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, type Page } from 'playwright'

const outDir = process.argv[2] ?? 'out/smoke'
await mkdir(outDir, { recursive: true })

// Some hosts (e.g. editor extension terminals) set ELECTRON_RUN_AS_NODE, which turns Electron into plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
const app = await electron.launch({ args: ['.'], env: env as Record<string, string> })

async function walk(win: Page, suffix: string) {
  await win.screenshot({ path: join(outDir, `1-start${suffix}.png`) })
  await win.getByRole('tab', { name: 'Files' }).click()
  await win.getByRole('button', { name: 'approval-policy.md', exact: true }).click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(outDir, `2-file${suffix}.png`) })
  await win.getByRole('tab', { name: 'Mail' }).click()
  await win.getByRole('button', { name: /Vendor portal access/ }).click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(outDir, `3-mail${suffix}.png`) })
  await win.getByRole('tab', { name: 'Finance' }).click()
  await win.getByText('Open ledger').click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(outDir, `4-finance${suffix}.png`) })
}

try {
  const win = await app.firstWindow()
  win.on('console', (m) => m.type() === 'error' && console.log(`[renderer error] ${m.text()}`))
  await win.waitForSelector('text=Arcus sandbox', { timeout: 30_000 })
  await win.setViewportSize({ width: 1480, height: 920 })
  await win.waitForTimeout(500)
  await walk(win, '')

  await win.getByRole('tab', { name: 'Portal' }).click()
  await win.getByText('Open in workspace').click()
  await win.waitForTimeout(1500)
  const portal = await app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find((c) => c instanceof WebContentsView) as InstanceType<typeof WebContentsView>
    return { bounds: view.getBounds(), visible: view.getVisible(), url: view.webContents.getURL(), png: (await view.webContents.capturePage()).toPNG().toString('base64') }
  })
  console.log('portal view:', JSON.stringify({ ...portal, png: undefined }))
  await writeFile(join(outDir, '5-portal.png'), Buffer.from(portal.png, 'base64'))
  const captcha = await win.evaluate(() => window.arcus.invoke('run:captcha', { runId: 'x' }))
  console.log('captcha via CDP:', captcha.svg ? `${captcha.svg.length} chars of SVG` : 'none')

  await win.emulateMedia({ colorScheme: 'dark' })
  await win.waitForTimeout(300)
  await walk(win, '-dark')
} finally {
  await app.close()
}
