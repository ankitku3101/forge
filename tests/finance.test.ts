import { afterEach, describe, expect, it } from 'vitest'
import { createRecord, getRecord, resolveVendor } from '../src/main/apps/finance'
import { verify } from '../src/main/agent/verification'
import { createHeadlessSandbox, type HeadlessSandbox } from '../src/main/sandbox/headless'
import { ToolFailure } from '../src/main/tools/types'
import { decide, loadPolicy, parsePolicyDocument, POLICY_FILE, STRICTEST_POLICY } from '../src/main/agent/policy'

const ACM_1058 = {
  vendor: 'Acme Supplies',
  invoiceNumber: 'ACM-1058',
  amount: 4812.5,
  currency: 'USD',
  issueDate: '2026-09-28',
  dueDate: '2026-10-28',
  status: 'unpaid' as const,
  notes: '',
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (e) {
    if (e instanceof ToolFailure) return e.code
    throw e
  }
}

describe('finance app', () => {
  let sb: HeadlessSandbox
  afterEach(() => sb?.close())

  it('resolves vendors exactly, partially, or reports ambiguity', async () => {
    sb = await createHeadlessSandbox('happy_path')
    const db = sb.database.db
    expect((await resolveVendor(db, 'acme supplies')).name).toBe('Acme Supplies')
    expect((await resolveVendor(db, 'Brightline')).name).toBe('Brightline Logistics')
    expect(await code(resolveVendor(db, 'Acme'))).toBe('AMBIGUOUS')
    expect(await code(resolveVendor(db, 'Globex'))).toBe('NOT_FOUND')
  })

  it('rejects duplicates', async () => {
    sb = await createHeadlessSandbox('duplicate')
    expect(await code(createRecord(sb.database.db, sb.faults, ACM_1058))).toBe('DUPLICATE_RECORD')
  })

  it('fails transiently once in transient_error', async () => {
    sb = await createHeadlessSandbox('transient_error')
    expect(await code(createRecord(sb.database.db, sb.faults, ACM_1058))).toBe('TRANSIENT')
    expect(await code(createRecord(sb.database.db, sb.faults, ACM_1058))).toBe('ok')
  })

  it('verifies a correct write and flags a silently rounded one', async () => {
    sb = await createHeadlessSandbox('happy_path')
    const rec = await createRecord(sb.database.db, sb.faults, ACM_1058)
    const writes = [{ kind: 'record' as const, tool: 'create_record', recordId: rec.id, submitted: { ...ACM_1058 } }]
    const ok = await verify({ db: sb.database.db, filesDir: sb.filesDir, scenario: 'happy_path', writes, claims: { records: [], files: [] } })
    expect(ok.status).toBe('verified')
    await sb.close()

    sb = await createHeadlessSandbox('verification_mismatch')
    const rounded = await createRecord(sb.database.db, sb.faults, ACM_1058)
    expect((await getRecord(sb.database.db, rounded.id)).amount).toBe(4813)
    const bad = await verify({
      db: sb.database.db,
      filesDir: sb.filesDir,
      scenario: 'verification_mismatch',
      writes: [{ ...writes[0]!, recordId: rounded.id }],
      claims: { records: [], files: [] },
    })
    expect(bad.status).toBe('mismatch')
    expect(bad.checks.find((c) => c.kind === 'write')?.detail).toContain('$4,813.00')
  })

  it('flags a value that disagrees with the source invoice', async () => {
    sb = await createHeadlessSandbox('happy_path')
    const wrong = { ...ACM_1058, dueDate: '2026-11-28' }
    const rec = await createRecord(sb.database.db, sb.faults, wrong)
    const res = await verify({
      db: sb.database.db,
      filesDir: sb.filesDir,
      scenario: 'happy_path',
      writes: [{ kind: 'record', tool: 'create_record', recordId: rec.id, submitted: wrong }],
      claims: { records: [], files: [] },
    })
    expect(res.checks.find((c) => c.kind === 'write')?.status).toBe('verified')
    expect(res.checks.find((c) => c.kind === 'outcome')?.status).toBe('mismatch')
  })
})

describe('policy', () => {
  const doc = (block: string) => `# Policy\n\n\`\`\`policy\n${block}\n\`\`\`\n`
  const loaded = parsePolicyDocument(doc('approval_threshold: 500\nmissing_due_date: note\nremit_account_mismatch: block'))

  it('parses the policy block from the document', () => {
    expect(loaded).toEqual({ policy: { approval_threshold: 500, missing_due_date: 'note', remit_account_mismatch: 'block' }, source: POLICY_FILE, warning: null })
  })

  it('maps risk and amount to a decision', () => {
    expect(decide({ risk: 'read', requiresApproval: false }, null, loaded).decision).toBe('auto')
    expect(decide({ risk: 'write', requiresApproval: false }, null, loaded).decision).toBe('auto')
    expect(decide({ risk: 'financial', requiresApproval: true }, 312.4, loaded).decision).toBe('auto')
    expect(decide({ risk: 'financial', requiresApproval: true }, 500, loaded).decision).toBe('approval')
    expect(decide({ risk: 'financial', requiresApproval: true }, null, loaded).decision).toBe('approval')
    expect(decide({ risk: 'destructive', requiresApproval: false }, null, loaded).decision).toBe('deny')
  })

  it('falls back to the strictest policy when the block is missing or invalid', () => {
    expect(parsePolicyDocument('# no block')).toMatchObject({ policy: STRICTEST_POLICY, warning: expect.stringContaining('no') })
    expect(parsePolicyDocument(doc('approval_threshold: lots'))).toMatchObject({ policy: STRICTEST_POLICY, warning: expect.stringContaining('invalid') })
  })

  it('reads the seeded policy from the sandbox Files', async () => {
    const sb = await createHeadlessSandbox('happy_path')
    try {
      expect((await loadPolicy(sb.filesDir)).policy.approval_threshold).toBe(500)
    } finally {
      await sb.close()
    }
  })
})
