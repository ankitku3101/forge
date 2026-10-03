/** Dev aid: screenshots the app, clicks Reset in the header, screenshots again. `pnpm tsx scripts/check-reset.ts <outDir>` */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const outDir = process.argv[2] ?? 'out/check-reset'
await mkdir(outDir, { recursive: true })
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
const app = await electron.launch({ args: ['.'], env: env as Record<string, string> })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => m.type() === 'error' && console.log(`[renderer error] ${m.text()}`))
  await win.waitForSelector('text=Arcus sandbox', { timeout: 30_000 })
  await win.setViewportSize({ width: 1480, height: 920 })
  await win.waitForTimeout(800)
  console.log('spinners before:', await win.locator('.animate-spin').count())
  await win.screenshot({ path: join(outDir, 'before.png') })
  await win.getByRole('button', { name: 'Reset' }).click()
  await win.waitForTimeout(2500)
  const runs = (await win.evaluate(() => window.arcus.invoke('run:list'))).length
  console.log('runs after reset:', runs, '· activity empty:', await win.getByText('Every step the worker takes appears here').isVisible())
  await win.screenshot({ path: join(outDir, 'after.png') })
} finally {
  await app.close()
}
