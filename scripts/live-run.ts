/**
 * Live end-to-end run of the desktop app with the real model.
 * Launches the built app, types a task into the chat, answers sign-in/captcha/approval through the
 * same UI a user would, screenshots each stage, and prints the run's timeline.
 *
 *   pnpm build:app && pnpm tsx scripts/live-run.ts [--scenario happy_path] [--task "..."] [--out dir] [--reject]
 *
 * Uses GROQ_API_KEY from .env. Credentials are the portal's demo login.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { _electron as electron, type Page } from 'playwright'
import type { RunEvent, RunInfo } from '../src/shared/types'

const { values: args } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'happy_path' },
    task: { type: 'string', default: 'Get the latest unpaid invoice from Acme Supplies on the vendor portal and add it to Finance.' },
    out: { type: 'string', default: 'out/live-run' },
    answer: { type: 'string', default: '' },
    reject: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '600' },
  },
})
await mkdir(args.out, { recursive: true })

const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
const app = await electron.launch({ args: ['.'], env: { ...(env as Record<string, string>), ARCUS_E2E: '1' } })
let shot = 0
const win = await app.firstWindow()
const snap = async (name: string) => {
  shot += 1
  const file = join(args.out, `${String(shot).padStart(2, '0')}-${name}.png`)
  // Capture the window plus the native portal view composited on top.
  const png = await app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    const base = await w.capturePage()
    const view = w.contentView.children.find((c) => c instanceof WebContentsView) as InstanceType<typeof WebContentsView> | undefined
    if (!view || !view.getVisible()) return { base: base.toPNG().toString('base64'), portal: null }
    return { base: base.toPNG().toString('base64'), portal: { png: (await view.webContents.capturePage()).toPNG().toString('base64'), bounds: view.getBounds() } }
  })
  await writeFile(file, Buffer.from(png.base, 'base64'))
  if (png.portal) await writeFile(file.replace('.png', '.portal.png'), Buffer.from(png.portal.png, 'base64'))
  console.log(`  [screenshot] ${file}`)
}

const invoke = <T>(page: Page, channel: string, input?: unknown) =>
  page.evaluate(([c, i]) => (window as unknown as { arcus: { invoke: (c: string, i?: unknown) => Promise<unknown> } }).arcus.invoke(c, i), [channel, input] as const) as Promise<T>

try {
  win.on('console', (m) => m.type() === 'error' && console.log(`[renderer error] ${m.text()}`))
  win.on('pageerror', (e) => console.log(`[renderer crash] ${e.stack ?? e.message}`))
  await win.waitForSelector('text=Arcus sandbox', { timeout: 30_000 })
  await win.setViewportSize({ width: 1480, height: 920 })

  for (const r of await invoke<RunInfo[]>(win, 'run:list')) {
    if (r.status === 'running' || r.status === 'awaiting_user') {
      console.log(`Cancelling leftover run ${r.id}`)
      await invoke(win, 'run:cancel', { runId: r.id })
    }
  }
  console.log(`Resetting sandbox to "${args.scenario}"`)
  await invoke(win, 'app:setScenario', { scenario: args.scenario })

  console.log(`Task: ${args.task}`)
  await win.getByPlaceholder(/Describe a task/).fill(args.task)
  await win.getByRole('button', { name: 'Start' }).click()

  const deadline = Date.now() + Number(args.timeout) * 1000
  let run: RunInfo | undefined
  let lastPending = ''
  for (;;) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the run to finish')
    run = (await invoke<RunInfo[]>(win, 'run:list'))[0]
    if (!run) {
      await win.waitForTimeout(500)
      continue
    }
    if (run.status === 'completed' || run.status === 'failed') break
    if (run.status === 'awaiting_user' && run.pending) {
      const key = run.pending.toolCallId + run.pending.kind
      if (key !== lastPending) {
        lastPending = key
        await win.waitForTimeout(600) // let the card render
        await snap(`waiting-${run.pending.kind}`)
        const p = run.pending
        console.log(`  -> worker asks: ${p.kind}${p.kind === 'question' ? `: ${p.question} ${JSON.stringify(p.options ?? [])}` : p.kind === 'approval' ? `: ${p.title}` : ''}`)
        if (p.kind === 'credentials') {
          await win.getByPlaceholder('Username').fill('demo')
          await win.getByPlaceholder('Password').fill('demo123')
          await win.getByRole('button', { name: 'Sign in', exact: true }).click()
        } else if (p.kind === 'captcha') {
          await win.getByAltText('captcha').waitFor({ timeout: 10_000 })
          const answer = await app.evaluate(() => (globalThis as unknown as { __arcusE2E: { captchaAnswer: () => Promise<string | null> } }).__arcusE2E.captchaAnswer())
          if (!answer) throw new Error('No captcha answer available')
          await win.getByPlaceholder('Characters').fill(answer)
          await win.getByRole('button', { name: 'Submit' }).click()
        } else if (p.kind === 'approval') {
          console.log(`     details: ${JSON.stringify(p.details)}`)
          await win.getByRole('button', { name: args.reject ? 'Reject' : 'Approve' }).click()
        } else if (p.kind === 'question') {
          const reply = args.answer || p.options?.[0] || 'Please continue with your best judgement and note any assumption.'
          console.log(`     answering: ${reply}`)
          if (p.options?.includes(reply)) await win.getByRole('button', { name: reply, exact: true }).click()
          else {
            await win.getByPlaceholder('Type an answer').fill(reply)
            await win.getByRole('button', { name: 'Send' }).click()
          }
        }
      }
    }
    await win.waitForTimeout(700)
  }

  await win.waitForTimeout(800)
  await snap(`final-${run.status}`)

  const events = await invoke<RunEvent[]>(win, 'run:events', { runId: run.id })
  await writeFile(join(args.out, 'events.json'), JSON.stringify(events, null, 2))
  console.log('\n=== Timeline ===')
  for (const e of events) {
    const t = e.at.slice(11, 19)
    if (e.type === 'tool_called') console.log(`${t} #${e.step} ${e.tool} ${JSON.stringify(e.input).slice(0, 150)}`)
    else if (e.type === 'tool_failed') console.log(`${t}    ✗ ${e.code}: ${e.message.slice(0, 200)}`)
    else if (e.type === 'tool_retry') console.log(`${t}    ↻ retry ${e.attempt}: ${e.message}`)
    else if (e.type === 'model_note') console.log(`${t}    note: ${e.text.slice(0, 200).replace(/\n/g, ' ')}`)
    else if (['policy_decision', 'injection_detected', 'llm_fallback', 'llm_waiting', 'user_responded', 'worklist_updated'].includes(e.type)) {
      const { runId: _r, seq: _s, at: _a, type, ...rest } = e
      console.log(`${t}    ${type} ${JSON.stringify(rest).slice(0, 200)}`)
    } else if (e.type === 'verification_passed' || e.type === 'verification_failed') {
      console.log(`${t}    ${e.type}: ${e.result.checks.map((c) => `[${c.kind} ${c.status}] ${c.target}: ${c.detail}`).join('\n             ')}`)
    } else if (e.type === 'task_completed') console.log(`${t} DONE: ${e.summary}`)
    else if (e.type === 'task_failed') console.log(`${t} FAILED: ${e.reason}`)
  }
  console.log(`\nStatus: ${run.status} · steps: ${run.stepCount} · verification: ${run.verification?.status ?? 'n/a'}`)
} finally {
  await app.close()
}
