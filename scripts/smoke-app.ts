/**
 * Dev aid: launches the built app (`pnpm build:app` first), checks the UI loads, attaches to the
 * portal view over CDP, and saves screenshots. `pnpm tsx scripts/smoke-app.ts <outDir>`
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const outDir = process.argv[2] ?? 'out/smoke'
await mkdir(outDir, { recursive: true })

// Some hosts (e.g. editor extension terminals) set ELECTRON_RUN_AS_NODE, which turns Electron into plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
const app = await electron.launch({ args: ['.'], env: env as Record<string, string> })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => console.log(`[renderer:${m.type()}] ${m.text()}`))
  await win.waitForSelector('text=Arcus sandbox', { timeout: 30_000 })
  await win.setViewportSize({ width: 1480, height: 900 })
  await win.screenshot({ path: join(outDir, '1-idle.png') })

  await win.getByText('approval-policy.md').click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: join(outDir, '2-file.png') })

  await win.getByTitle('Finance').click()
  await win.getByText('Open table').click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: join(outDir, '3-finance.png') })

  await win.getByTitle('Vendor Portal').click()
  await win.getByText('Open in workspace').click()
  await win.waitForTimeout(1500)
  // The portal is a native view; capture the whole window from the main process.
  const portal = await app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find((c) => c instanceof WebContentsView) as InstanceType<typeof WebContentsView>
    return { bounds: view.getBounds(), visible: view.getVisible(), url: view.webContents.getURL(), png: (await view.webContents.capturePage()).toPNG().toString('base64') }
  })
  console.log('portal view:', JSON.stringify({ ...portal, png: undefined }))
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(outDir, '4-portal.png'), Buffer.from(portal.png, 'base64'))

  // CDP attach path used by the browser tools: fetch the captcha through IPC.
  const captcha = await win.evaluate(() => window.arcus.invoke('run:captcha', { runId: 'x' }))
  console.log('captcha via CDP:', captcha.svg ? `${captcha.svg.length} chars of SVG` : 'none')
  console.log('state:', JSON.stringify(await win.evaluate(() => window.arcus.invoke('app:state'))))
} finally {
  await app.close()
}
