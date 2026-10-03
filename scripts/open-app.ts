/** Dev aid: opens the built app, logs renderer errors for a few seconds, saves a screenshot. */
import { _electron as electron } from 'playwright'

const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
const app = await electron.launch({ args: ['.'], env: env as Record<string, string> })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => m.type() === 'error' && console.log(`[renderer error] ${m.text().split('\n').slice(0, 4).join(' | ')}`))
  win.on('pageerror', (e) => console.log(`[renderer crash] ${e.message}`))
  await win.waitForTimeout(Number(process.argv[3] ?? 6000))
  if (process.argv[2] && process.argv[2] !== '-') await win.screenshot({ path: process.argv[2] })
  if (process.argv[4]) console.log('eval:', await win.evaluate(process.argv[4]))
} finally {
  await app.close()
}
