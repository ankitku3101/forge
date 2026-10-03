import { readFile } from 'node:fs/promises'
import type { ScenarioId } from '@shared/scenarios'
import type { VerificationCheck, VerificationResult, VerificationStatus } from '@shared/types'
import { getRecord, searchRecords, toCents } from '../apps/finance'
import type { Db } from '../db/client'
import type { WriteLogEntry } from '../db/schema'
import { resolveSandboxPath, sha256 } from '../sandbox/files'
import { groundTruthFor, truthKey } from '../sandbox/fixtures'
import { formatMoney } from '../sandbox/pdf'
import type { FinishInput } from '../tools/worker'

interface VerifyInput {
  db: Db
  filesDir: string
  scenario: ScenarioId
  writes: WriteLogEntry[]
  claims: FinishInput['claims']
}

/**
 * Independent verification, done by code rather than the model:
 * 1. Write check: re-read every record/file the worker wrote and compare with what it submitted.
 * 2. Outcome check: compare stored values with the seeded ground truth.
 */
export async function verify({ db, filesDir, scenario, writes, claims }: VerifyInput): Promise<VerificationResult> {
  const truth = groundTruthFor(scenario)
  const checks: VerificationCheck[] = []
  const outcomeChecked = new Set<number>()

  const lastRecordWrites = new Map<number, Extract<WriteLogEntry, { kind: 'record' }>>()
  const lastFileWrites = new Map<string, Extract<WriteLogEntry, { kind: 'file' }>>()
  for (const w of writes) {
    if (w.kind === 'record') lastRecordWrites.set(w.recordId, w)
    else lastFileWrites.set(w.path, w)
  }

  for (const w of lastRecordWrites.values()) {
    const target = `${w.submitted.vendor} ${w.submitted.invoiceNumber}`
    let stored
    try {
      stored = await getRecord(db, w.recordId)
    } catch {
      checks.push({ kind: 'write', target, status: 'mismatch', detail: `Record ${w.recordId} no longer exists.` })
      continue
    }
    const diffs: string[] = []
    if (toCents(stored.amount) !== toCents(w.submitted.amount)) {
      diffs.push(`amount submitted ${formatMoney(toCents(w.submitted.amount))}, stored ${formatMoney(toCents(stored.amount))}`)
    }
    if (stored.dueDate !== w.submitted.dueDate) diffs.push(`due date submitted ${w.submitted.dueDate ?? 'none'}, stored ${stored.dueDate ?? 'none'}`)
    if (stored.issueDate !== w.submitted.issueDate) diffs.push(`issue date submitted ${w.submitted.issueDate ?? 'none'}, stored ${stored.issueDate ?? 'none'}`)
    if (stored.status !== w.submitted.status) diffs.push(`status submitted ${w.submitted.status}, stored ${stored.status}`)
    if (stored.invoiceNumber !== w.submitted.invoiceNumber.trim()) diffs.push(`invoice number submitted ${w.submitted.invoiceNumber}, stored ${stored.invoiceNumber}`)
    checks.push(
      diffs.length
        ? { kind: 'write', target, status: 'mismatch', detail: `Finance stored different values: ${diffs.join('; ')}.` }
        : { kind: 'write', target, status: 'verified', detail: `Record ${stored.id} re-read; stored values match what was submitted.` },
    )
    checks.push(outcomeCheck(stored, truth.invoices))
    outcomeChecked.add(stored.id)
  }

  // Claimed records that were not written in this run (e.g. "already in Finance") still get an outcome check.
  for (const c of claims.records) {
    const found = (await searchRecords(db, { vendor: c.vendor, invoiceNumber: c.invoiceNumber })).find(
      (r) => r.invoiceNumber.toUpperCase() === c.invoiceNumber.trim().toUpperCase(),
    )
    if (!found) {
      checks.push({ kind: 'outcome', target: `${c.vendor} ${c.invoiceNumber}`, status: 'mismatch', detail: 'Claimed record does not exist in Finance.' })
    } else if (!outcomeChecked.has(found.id)) {
      checks.push(outcomeCheck(found, truth.invoices))
      outcomeChecked.add(found.id)
    }
  }

  for (const w of lastFileWrites.values()) {
    let content: Buffer
    try {
      content = await readFile(resolveSandboxPath(filesDir, w.path))
    } catch {
      checks.push({ kind: 'write', target: w.path, status: 'mismatch', detail: 'File no longer exists.' })
      continue
    }
    const same = sha256(content) === w.sha256
    checks.push({
      kind: 'write',
      target: w.path,
      status: same ? 'verified' : 'mismatch',
      detail: same ? 'File re-read; content matches what was written.' : 'File content differs from what was written.',
    })
    const expect = truth.files[w.path]
    if (expect && w.tool === 'write_file') {
      const text = content.toString('utf8').toUpperCase()
      const missing = expect.mustMention.filter((m) => !text.includes(m.toUpperCase()))
      checks.push({
        kind: 'outcome',
        target: w.path,
        status: missing.length ? 'mismatch' : 'verified',
        detail: missing.length ? `Missing expected items: ${missing.join(', ')}.` : `Mentions all ${expect.mustMention.length} expected items.`,
      })
    }
  }

  for (const path of claims.files) {
    const norm = path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (lastFileWrites.has(norm)) continue
    const exists = await readFile(resolveSandboxPath(filesDir, norm)).then(
      () => true,
      () => false,
    )
    checks.push({
      kind: 'write',
      target: norm,
      status: exists ? 'unverifiable' : 'mismatch',
      detail: exists ? 'File exists but was not written in this run.' : 'Claimed file does not exist.',
    })
  }

  return { status: overall(checks), checks }
}

function outcomeCheck(
  stored: { vendorName: string; invoiceNumber: string; amount: number; dueDate: string | null; issueDate: string | null },
  invoices: ReturnType<typeof groundTruthFor>['invoices'],
): VerificationCheck {
  const target = `${stored.vendorName} ${stored.invoiceNumber}`
  const t = invoices.get(truthKey(stored.vendorName, stored.invoiceNumber))
  if (!t) return { kind: 'outcome', target, status: 'unverifiable', detail: 'No ground truth for this invoice.' }
  const diffs: string[] = []
  if (toCents(stored.amount) !== t.amountCents) diffs.push(`amount is ${formatMoney(toCents(stored.amount))}, invoice says ${formatMoney(t.amountCents)}`)
  if (stored.dueDate !== t.dueDate) diffs.push(`due date is ${stored.dueDate ?? 'none'}, invoice says ${t.dueDate ?? 'none'}`)
  if (stored.issueDate !== null && stored.issueDate !== t.issueDate) diffs.push(`issue date is ${stored.issueDate}, invoice says ${t.issueDate}`)
  return diffs.length
    ? { kind: 'outcome', target, status: 'mismatch', detail: `Does not match the source invoice: ${diffs.join('; ')}.` }
    : { kind: 'outcome', target, status: 'verified', detail: 'Matches the source invoice.' }
}

function overall(checks: VerificationCheck[]): VerificationStatus {
  if (checks.length === 0) return 'unverifiable'
  if (checks.some((c) => c.status === 'mismatch')) return 'mismatch'
  if (checks.every((c) => c.status === 'verified')) return 'verified'
  return 'unverifiable'
}
