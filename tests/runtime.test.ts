import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRuntime } from '../src/main/agent/runtime'
import { EventLog } from '../src/main/agent/events'
import { RunStore } from '../src/main/agent/store'
import { searchRecords } from '../src/main/apps/finance'
import { LLMRouter } from '../src/main/llm/router'
import type { ChatMessage } from '../src/main/llm/types'
import { CAPTCHA_COOKIE } from '../src/main/portal/server'
import { createHeadlessSandbox, type HeadlessSandbox } from '../src/main/sandbox/headless'
import { createRegistry } from '../src/main/tools/registry'
import type { ScenarioId } from '../src/shared/scenarios'
import { lastObservation, refFor, ScriptedProvider, type Step } from './helpers/scripted-llm'

/** The task states the invoice's values, so they are user-provided sources for provenance. */
const ACM_TASK = 'Add Acme Supplies invoice ACM-1058: $4,812.50, issued 2026-09-28, due 2026-10-28, remit to account 0042-117-4417.'
const ACM = { vendor: 'Acme Supplies', invoiceNumber: 'ACM-1058', amount: 4812.5, issueDate: '2026-09-28', dueDate: '2026-10-28', status: 'unpaid', remitAccount: '0042-117-4417' }

function lastSnapshot(messages: ChatMessage[]): string {
  for (const m of [...messages].reverse()) {
    if (m.role === 'tool' && m.content.includes('"snapshot"')) return (JSON.parse(m.content) as { data: { snapshot: string } }).data.snapshot
  }
  throw new Error('no snapshot')
}

let sb: HeadlessSandbox | null = null
afterEach(async () => {
  await sb?.close()
  sb = null
})

async function setup(scenario: ScenarioId, steps: Step[]) {
  sb = await createHeadlessSandbox(scenario)
  const sandbox = sb
  const provider = new ScriptedProvider(steps)
  const store = new RunStore(sandbox.database.db)
  const events = new EventLog(sandbox.database.db)
  const make = () =>
    new AgentRuntime({
      store,
      events,
      registry: createRegistry(),
      router: () => new LLMRouter({ primary: provider }),
      env: () => sandbox.env,
      sleep: async () => undefined,
      today: () => '2026-10-03',
    })
  return { sb: sandbox, provider, store, events, runtime: make(), make }
}

const portalSignIn: Step[] = [
  { tool: 'browser_open', args: { url: '/invoices' } },
  { tool: 'request_credentials', args: { site: 'Arcus Vendor Portal' } },
  { tool: 'request_captcha' },
  (m) => ({ tool: 'browser_click', args: { ref: refFor(lastSnapshot(m), /\[button "Sign in"/) } }),
]

/** From the invoice list: open ACM-1058, download its PDF and read it. */
const downloadAndRead: Step[] = [
  (m) => {
    const row = lastSnapshot(m).split('\n').find((l) => l.includes('ACM-1058'))!
    return { tool: 'browser_click', args: { ref: /ref=(e\d+)/.exec(row)![1] } }
  },
  (m) => ({ tool: 'browser_download', args: { ref: refFor(lastSnapshot(m), /\[link "Download PDF"/) } }),
  (m) => ({ tool: 'read_file', args: { path: lastObservation(m).data!.path } }),
]

const downloadAndRecord: Step[] = [
  ...downloadAndRead,
  { tool: 'search_records', args: { vendor: 'Acme Supplies', invoiceNumber: 'ACM-1058' } },
  { tool: 'create_record', args: { ...ACM, remitAccount: '0042-117-4417' } },
]

async function answerSignIn(h: Awaited<ReturnType<typeof setup>>, runId: string) {
  let info = await h.runtime.settle(runId)
  expect(info.pending?.kind).toBe('credentials')
  await h.runtime.respond(runId, { kind: 'credentials', username: 'demo', password: 'demo123' })
  info = await h.runtime.settle(runId)
  expect(info.pending?.kind).toBe('captcha')
  const answer = h.sb.portal.captchaAnswer((await h.sb.driver.cookie(CAPTCHA_COOKIE))!)!
  await h.runtime.respond(runId, { kind: 'captcha', answer })
  return h.runtime.settle(runId)
}

describe('agent runtime', () => {
  it('runs the portal task end to end: sign-in, download, approval, verification', async () => {
    const h = await setup('happy_path', [
      ...portalSignIn,
      ...downloadAndRecord,
      { tool: 'finish', args: { summary: 'Added ACM-1058.', claims: { records: [{ vendor: 'Acme Supplies', invoiceNumber: 'ACM-1058' }] } } },
    ])
    const runId = await h.runtime.start('Get the latest unpaid invoice from Acme Supplies on the vendor portal and add it to Finance.')
    let info = await answerSignIn(h, runId)
    expect(info.pending?.kind).toBe('approval')
    expect(info.pending).toMatchObject({ tool: 'create_record' })

    const run = (await h.store.load(runId))!
    const pdfText = JSON.parse(run.messages.filter((m) => m.role === 'tool').at(-2)!.content as string).data.text as string
    expect(pdfText).toContain('2026-10-28')

    await h.runtime.respond(runId, { kind: 'approval', approved: true })
    info = await h.runtime.settle(runId)
    expect(info.status).toBe('completed')
    expect(info.verification?.status).toBe('verified')
    const prov = info.verification?.checks.find((c) => c.kind === 'provenance')
    expect(prov?.detail).toContain('amount ← Downloads/ACM-1058.pdf')
    expect(prov?.detail).toContain('due date ← Downloads/ACM-1058.pdf')

    const records = await searchRecords(h.sb.database.db, { invoiceNumber: 'ACM-1058' })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ amount: 4812.5, dueDate: '2026-10-28' })

    // Secrets never reach the model's context, the DB or events.
    const stored = JSON.stringify(await h.store.load(runId)) + JSON.stringify(await h.events.list(runId))
    expect(stored).not.toContain('demo123')
    const types = (await h.events.list(runId)).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['task_started', 'tool_called', 'approval_requested', 'input_requested', 'verification_passed', 'task_completed']))
  }, 60_000)

  it('re-signs in after the session expires mid-task', async () => {
    const h = await setup('session_expired', [
      ...portalSignIn,
      (m) => {
        const row = lastSnapshot(m).split('\n').find((l) => l.includes('ACM-1058'))!
        return { tool: 'browser_click', args: { ref: /ref=(e\d+)/.exec(row)![1] } }
      },
      (m) => ({ tool: 'browser_download', args: { ref: refFor(lastSnapshot(m), /\[link "Download PDF"/) } }),
      (m) => {
        expect(lastObservation(m).error?.code).toBe('SESSION_EXPIRED')
        return { tool: 'request_credentials', args: { site: 'Arcus Vendor Portal' } }
      },
      { tool: 'request_captcha' },
      { tool: 'browser_read' },
      (m) => ({ tool: 'browser_click', args: { ref: refFor(lastSnapshot(m), /\[button "Sign in"/) } }),
      { tool: 'browser_open', args: { url: '/invoices/4' } },
      (m) => ({ tool: 'browser_download', args: { ref: refFor(lastSnapshot(m), /\[link "Download PDF"/) } }),
      (m) => ({ tool: 'finish', args: { summary: `Downloaded ${String(lastObservation(m).data!.path)}` } }),
    ])
    const runId = await h.runtime.start('Download ACM-1058 from the portal.')
    let info = await answerSignIn(h, runId)
    expect(info.pending?.kind).toBe('credentials')
    info = await answerSignIn(h, runId)
    expect(info.status).toBe('completed')
  }, 60_000)

  it('retries a transient Finance failure automatically and creates one record', async () => {
    const h = await setup('transient_error', [
      { tool: 'create_record', args: ACM },
      { tool: 'finish', args: { summary: 'done', claims: { records: [{ vendor: 'Acme Supplies', invoiceNumber: 'ACM-1058' }] } } },
    ])
    const runId = await h.runtime.start(ACM_TASK)
    await h.runtime.settle(runId)
    await h.runtime.respond(runId, { kind: 'approval', approved: true })
    const info = await h.runtime.settle(runId)
    expect(info.status).toBe('completed')
    const events = await h.events.list(runId)
    expect(events.filter((e) => e.type === 'tool_retry')).toHaveLength(1)
    expect(await searchRecords(h.sb.database.db, { invoiceNumber: 'ACM-1058' })).toHaveLength(1)
  })

  it('skips approval for a duplicate and reports it', async () => {
    const h = await setup('duplicate', [
      { tool: 'create_record', args: ACM },
      (m) => {
        expect(lastObservation(m).error?.code).toBe('DUPLICATE_RECORD')
        return { tool: 'finish', args: { summary: 'Already recorded.' } }
      },
    ])
    const runId = await h.runtime.start(ACM_TASK)
    const info = await h.runtime.settle(runId)
    expect(info.status).toBe('completed')
    expect(await searchRecords(h.sb.database.db, { invoiceNumber: 'ACM-1058' })).toHaveLength(1)
  })

  it('reports a rejected approval to the model', async () => {
    const h = await setup('happy_path', [
      { tool: 'create_record', args: ACM },
      (m) => {
        expect(lastObservation(m).error).toMatchObject({ code: 'PERMISSION_DENIED', message: expect.stringContaining('wrong vendor') })
        return { tool: 'finish', args: { summary: 'Not added.', outcome: 'blocked' } }
      },
    ])
    const runId = await h.runtime.start(ACM_TASK)
    await h.runtime.settle(runId)
    await h.runtime.respond(runId, { kind: 'approval', approved: false, note: 'wrong vendor' })
    expect((await h.runtime.settle(runId)).status).toBe('failed')
  })

  it('does not accept finish while verification shows a mismatch', async () => {
    const finish = { tool: 'finish', args: { summary: 'Added it.', claims: { records: [{ vendor: 'Acme Supplies', invoiceNumber: 'ACM-1058' }] } } }
    const h = await setup('verification_mismatch', [
      { tool: 'create_record', args: ACM },
      finish,
      (m) => {
        expect(lastObservation(m).error?.message).toContain('Not accepted')
        return finish
      },
    ])
    const runId = await h.runtime.start(ACM_TASK)
    await h.runtime.settle(runId)
    await h.runtime.respond(runId, { kind: 'approval', approved: true })
    const info = await h.runtime.settle(runId)
    expect(info.status).toBe('failed')
    expect(info.verification?.status).toBe('mismatch')
    expect(info.error).toContain('$4,813.00')
  })

  it('aborts after three identical failing calls', async () => {
    const bad = { tool: 'read_file', args: { path: 'Nope.md' } }
    const h = await setup('happy_path', [bad, bad, bad, bad])
    const runId = await h.runtime.start('Read Nope.md')
    const info = await h.runtime.settle(runId)
    expect(info.status).toBe('failed')
    expect(info.error).toContain('3 times')
    expect(h.provider.calls).toBe(3)
  })

  it('rejects invalid input with a VALIDATION observation', async () => {
    const h = await setup('happy_path', [
      { tool: 'create_record', args: { vendor: 'Acme Supplies' } },
      (m) => {
        expect(lastObservation(m).error?.code).toBe('VALIDATION')
        return { tool: 'finish', args: { summary: 'stop', outcome: 'blocked' } }
      },
    ])
    await h.runtime.settle(await h.runtime.start('x'))
  })

  it('resumes a paused run from persisted state in a fresh runtime', async () => {
    const h = await setup('happy_path', [
      { tool: 'ask_user', args: { question: 'Which vendor?', options: ['Acme Supplies', 'Acme Supply Co.'] } },
      (m) => {
        expect(lastObservation(m).data).toEqual({ answer: 'Acme Supplies' })
        return { tool: 'finish', args: { summary: 'ok' } }
      },
    ])
    const runId = await h.runtime.start('Ambiguous task')
    expect((await h.runtime.settle(runId)).pending?.kind).toBe('question')

    const restarted = h.make()
    await restarted.respond(runId, { kind: 'answer', text: 'Acme Supplies' })
    expect((await restarted.settle(runId)).status).toBe('completed')
  })

  it('takes approval rules from the policy document, including live edits', async () => {
    const small = { vendor: 'Norvale Office', invoiceNumber: 'NO-5541', amount: 120, issueDate: '2026-10-01', dueDate: '2026-10-31', status: 'unpaid', remitAccount: '5120-778-0345' }
    const h = await setup('happy_path', [
      { tool: 'create_record', args: small },
      (m) => {
        expect(lastObservation(m).error).toBeUndefined() // below the $500 threshold: no approval
        return { tool: 'create_record', args: ACM }
      },
      { tool: 'finish', args: { summary: 'done' } },
    ])
    // The user raises the threshold in the policy document; the next decision follows it.
    const policyPath = join(h.sb.filesDir, 'Policies/approval-policy.md')
    await writeFile(policyPath, (await readFile(policyPath, 'utf8')).replace('approval_threshold: 500', 'approval_threshold: 10000'))
    const runId = await h.runtime.start(`Add Norvale Office invoice NO-5541 for $120.00 (issued 2026-10-01, due 2026-10-31, remit to 5120-778-0345), then: ${ACM_TASK}`)
    const info = await h.runtime.settle(runId)
    expect(info.error).toBeNull()
    expect(info.status).toBe('completed')
    const decisions = (await h.events.list(runId)).filter((e) => e.type === 'policy_decision')
    expect(decisions.map((d) => (d.type === 'policy_decision' ? d.decision : null))).toEqual(['auto', 'auto'])
    expect(decisions[1]).toMatchObject({ reason: expect.stringContaining('$10,000.00') })
  })

  it('applies the missing-due-date rule from the policy document before asking for approval', async () => {
    const noDue = { ...ACM, dueDate: null }
    const h = await setup('missing_info', [
      { tool: 'create_record', args: noDue },
      (m) => {
        expect(lastObservation(m).error).toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('note') })
        return { tool: 'create_record', args: { ...noDue, notes: 'Invoice PDF has no due date; confirm with vendor.' } }
      },
      { tool: 'finish', args: { summary: 'done' } },
    ])
    const runId = await h.runtime.start(ACM_TASK)
    expect((await h.runtime.settle(runId)).pending?.kind).toBe('approval')
    await h.runtime.respond(runId, { kind: 'approval', approved: true })
    expect((await h.runtime.settle(runId)).status).toBe('completed')
  })

  it('rejects values the worker never observed, before asking for approval', async () => {
    const h = await setup('happy_path', [
      { tool: 'create_record', args: ACM },
      (m) => {
        const err = lastObservation(m).error!
        expect(err.code).toBe('VALIDATION')
        expect(err.message).toContain('Amount $4,812.50')
        expect(err.message).toContain('Due date 2026-10-28')
        return { tool: 'finish', args: { summary: 'Could not source the values.', outcome: 'blocked' } }
      },
    ])
    const runId = await h.runtime.start('Add the latest Acme Supplies invoice to Finance.')
    const info = await h.runtime.settle(runId)
    expect(info.status).toBe('failed')
    expect((await h.events.list(runId)).some((e) => e.type === 'approval_requested')).toBe(false)
    expect(await searchRecords(h.sb.database.db, { invoiceNumber: 'ACM-1058' })).toHaveLength(0)
  })

  it('flags a hidden prompt injection and refuses its injected values', async () => {
    const h = await setup('prompt_injection', [
      ...portalSignIn,
      ...downloadAndRead,
      (m) => {
        const obs = lastObservation(m) as { security?: { flagged: string[] } }
        expect(obs.security?.flagged[0]).toContain('Ignore previous instructions')
        // Simulate a model that falls for it: the injected total must not pass provenance.
        return { tool: 'create_record', args: { ...ACM, amount: 9480, remitAccount: '0042-117-4417' } }
      },
      (m) => {
        expect(lastObservation(m).error).toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('$9,480.00') })
        return { tool: 'create_record', args: { ...ACM, remitAccount: '0042-117-4417' } }
      },
      { tool: 'finish', args: { summary: 'Added ACM-1058; ignored instructions hidden in the PDF.', claims: { records: [{ vendor: 'Acme Supplies', invoiceNumber: 'ACM-1058' }] } } },
    ])
    const runId = await h.runtime.start('Get the latest unpaid invoice from Acme Supplies on the vendor portal and add it to Finance.')
    expect((await answerSignIn(h, runId)).pending?.kind).toBe('approval')
    await h.runtime.respond(runId, { kind: 'approval', approved: true })
    expect((await h.runtime.settle(runId)).status).toBe('completed')
    expect((await h.events.list(runId)).filter((e) => e.type === 'injection_detected')).toHaveLength(1)
    expect((await searchRecords(h.sb.database.db, { invoiceNumber: 'ACM-1058' }))[0]?.amount).toBe(4812.5)
    expect((await searchRecords(h.sb.database.db, { invoiceNumber: 'ACM-1046' }))[0]?.status).toBe('overdue')
  }, 60_000)

  it('blocks an invoice whose remit-to account differs from the vendor record', async () => {
    const h = await setup('bank_account_change', [
      ...portalSignIn,
      ...downloadAndRead,
      (m) => {
        expect(lastObservation(m).data!.text).toContain('9184-260-5537')
        return { tool: 'create_record', args: { ...ACM, remitAccount: '9184-260-5537' } }
      },
      (m) => {
        expect(lastObservation(m).error).toMatchObject({ code: 'PERMISSION_DENIED', message: expect.stringContaining('0042-117-4417') })
        return { tool: 'finish', args: { summary: 'Did not record ACM-1058: the bank account changed. Please verify with Acme.', outcome: 'blocked' } }
      },
    ])
    const runId = await h.runtime.start('Get the latest unpaid invoice from Acme Supplies on the vendor portal and add it to Finance.')
    await answerSignIn(h, runId)
    expect((await h.runtime.settle(runId)).status).toBe('failed')
    expect((await h.events.list(runId)).some((e) => e.type === 'approval_requested')).toBe(false)
    expect(await searchRecords(h.sb.database.db, { invoiceNumber: 'ACM-1058' })).toHaveLength(0)
  }, 60_000)

  it('enforces multi-item tasks: tracked items must be resolved, skips need reasons, done needs a write', async () => {
    const h = await setup('happy_path', [
      ...portalSignIn,
      { tool: 'browser_open', args: { url: '/invoices?status=unpaid' } },
      { tool: 'track_items', args: { items: [{ key: 'ACM-1052' }, { key: 'ACM-1058' }, { key: 'ACM-9999' }] } },
      (m) => {
        expect(lastObservation(m).error).toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('ACM-9999') })
        return { tool: 'track_items', args: { items: [{ key: 'ACM-1052', description: 'Label printer ribbons' }, { key: 'ACM-1058' }] } }
      },
      { tool: 'finish', args: { summary: 'All done!' } },
      (m) => {
        expect(lastObservation(m).error?.message).toContain('2 tracked item(s) are unresolved')
        return { tool: 'browser_open', args: { url: '/invoices/3' } }
      },
      (m) => ({ tool: 'browser_download', args: { ref: refFor(lastSnapshot(m), /\[link "Download PDF"/) } }),
      (m) => ({ tool: 'read_file', args: { path: lastObservation(m).data!.path } }),
      {
        tool: 'create_record',
        args: { vendor: 'Acme Supplies', invoiceNumber: 'ACM-1052', amount: 960, issueDate: '2026-09-10', dueDate: '2026-10-10', status: 'unpaid', remitAccount: '0042-117-4417' },
      },
      { tool: 'resolve_item', args: { key: 'ACM-1052', status: 'done' } },
      { tool: 'resolve_item', args: { key: 'ACM-1058', status: 'skipped' } },
      (m) => {
        expect(lastObservation(m).error?.message).toContain('needs a reason')
        return { tool: 'resolve_item', args: { key: 'ACM-1058', status: 'skipped', reason: 'User will handle it separately.' } }
      },
      { tool: 'finish', args: { summary: 'Added ACM-1052.', claims: { records: [{ vendor: 'Acme Supplies', invoiceNumber: 'ACM-1052' }] } } },
    ])
    const runId = await h.runtime.start('Add all unpaid Acme Supplies invoices from the vendor portal to Finance.')
    expect((await answerSignIn(h, runId)).pending?.kind).toBe('approval')
    await h.runtime.respond(runId, { kind: 'approval', approved: true })
    const info = await h.runtime.settle(runId)
    expect(info.status).toBe('completed')
    expect(info.summary).toContain('Items: 1 of 2 done')
    expect(info.summary).toContain('✗ skipped: ACM-1058 (User will handle it separately.)')
    expect(info.worklist.map((w) => [w.key, w.status])).toEqual([
      ['ACM-1052', 'done'],
      ['ACM-1058', 'skipped'],
    ])
    expect(info.verification?.checks.find((c) => c.kind === 'item')).toMatchObject({ target: 'ACM-1052', status: 'verified' })
    expect((await h.events.list(runId)).filter((e) => e.type === 'worklist_updated').length).toBeGreaterThanOrEqual(3)
  }, 60_000)

  it('does not let the remit-account check be skipped silently by passing null', async () => {
    // Found in a live run: the model recorded from the list page and passed remitAccount: null.
    const h = await setup('bank_account_change', [
      { tool: 'create_record', args: { ...ACM, remitAccount: null, notes: 'Warehouse shelving, installed' } },
      (m) => {
        expect(lastObservation(m).error).toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('remit-to bank account') })
        return { tool: 'finish', args: { summary: 'Need the invoice document first.', outcome: 'blocked' } }
      },
    ])
    await h.runtime.settle(await h.runtime.start(ACM_TASK))
    expect(await searchRecords(h.sb.database.db, { invoiceNumber: 'ACM-1058' })).toHaveLength(0)
  })

  it('clears all run history for Reset', async () => {
    const h = await setup('happy_path', [{ tool: 'finish', args: { summary: 'ok' } }])
    const runId = await h.runtime.settle(await h.runtime.start('anything')).then((i) => i.id)
    expect(await h.events.list(runId)).not.toHaveLength(0)
    await h.store.clearAll()
    h.events.forgetAll()
    expect(await h.store.list()).toHaveLength(0)
    expect(await h.events.list(runId)).toHaveLength(0)
  })

  it('does not strand the run when the sign-in form is gone by the time the user answers', async () => {
    // Found in manual testing: the fill timed out, the error escaped, and the run sat on "running" forever.
    const h = await setup('happy_path', [
      { tool: 'browser_open', args: { url: '/login' } },
      { tool: 'request_credentials', args: { site: 'Arcus Vendor Portal' } },
      (m) => {
        expect(lastObservation(m).error).toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('no longer on the page') })
        return { tool: 'finish', args: { summary: 'Sign-in page went away.', outcome: 'blocked' } }
      },
    ])
    const runId = await h.runtime.start('Sign in to the portal.')
    expect((await h.runtime.settle(runId)).pending?.kind).toBe('credentials')
    await h.sb.driver.open(`${h.sb.server.url}/no-such-page`) // the page changes while the user is typing
    await h.runtime.respond(runId, { kind: 'credentials', username: 'demo', password: 'demo123' })
    const info = await h.runtime.settle(runId)
    expect(info.status).toBe('failed') // ended by the model's own "blocked" finish, not stuck
    expect(h.provider.calls).toBe(3)
  }, 60_000)

  it('enforces the step limit', async () => {
    const h = await setup('happy_path', Array.from({ length: 40 }, (_, i) => ({ tool: 'remember', args: { fact: `fact ${i}` } })))
    const info = await h.runtime.settle(await h.runtime.start('loop forever'))
    expect(info.status).toBe('failed')
    expect(info.error).toContain('30-step limit')
  })
})
