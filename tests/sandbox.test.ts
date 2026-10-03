import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as s from '../src/main/db/schema'
import { pdfToText } from '../src/main/sandbox/files'
import { fixturesFor, groundTruthFor, invoiceTotalCents, truthKey } from '../src/main/sandbox/fixtures'
import { createHeadlessSandbox, type HeadlessSandbox } from '../src/main/sandbox/headless'
import { SCENARIOS } from '../src/shared/scenarios'

describe('fixtures', () => {
  it('applies scenario patches without mutating the base fixtures', () => {
    expect(fixturesFor('missing_info').portalInvoices.find((i) => i.invoiceNumber === 'ACM-1058')?.dueDate).toBeNull()
    expect(fixturesFor('happy_path').portalInvoices.find((i) => i.invoiceNumber === 'ACM-1058')?.dueDate).toBe('2026-10-28')
    expect(fixturesFor('duplicate').financeRecords.some((r) => r.invoiceNumber === 'ACM-1058')).toBe(true)
    expect(fixturesFor('ambiguous_vendor').portalInvoices.find((i) => i.invoiceNumber === 'ASC-0791')?.status).toBe('unpaid')
  })

  it('computes ground truth from line items', () => {
    const truth = groundTruthFor('happy_path').invoices.get(truthKey('Acme Supplies', 'ACM-1058'))
    expect(truth?.amountCents).toBe(481250)
    expect(invoiceTotalCents({ lineItems: [{ description: 'x', quantity: 15, unitPrice: 132.05 }] })).toBe(198075)
  })
})

describe('seeded sandbox', () => {
  let sb: HeadlessSandbox
  beforeAll(async () => {
    sb = await createHeadlessSandbox('happy_path')
  })
  afterAll(() => sb.close())

  it('round-trips every table through Drizzle (DDL matches schema)', async () => {
    const db = sb.database.db
    expect((await db.select().from(s.vendors)).length).toBe(4)
    expect((await db.select().from(s.financeRecords)).length).toBe(7)
    expect((await db.select().from(s.mail)).length).toBe(15)
    expect((await db.select().from(s.mailAttachments)).length).toBe(1)
    expect((await db.select().from(s.portalInvoices)).length).toBe(10)
    expect((await db.select().from(s.portalUsers)).length).toBe(1)
    expect((await db.select().from(s.sandboxMeta).where(eq(s.sandboxMeta.key, 'scenario')))[0]?.value).toBe('happy_path')
    await db.insert(s.runs).values({ id: 'r1', goal: 'g', scenario: 'happy_path', status: 'running', messages: [], facts: [], writes: [] })
    await db.insert(s.runEvents).values({ runId: 'r1', seq: 1, type: 'task_started', data: { type: 'task_started', goal: 'g', scenario: 'happy_path' } })
    expect((await db.select().from(s.runEvents)).length).toBe(1)
  })

  it('enforces vendor + invoice number uniqueness in the database', async () => {
    const [rec] = await sb.database.db.select().from(s.financeRecords).limit(1)
    await expect(sb.database.db.insert(s.financeRecords).values({ ...rec!, id: undefined as never })).rejects.toThrow()
  })

  it('writes invoice PDFs whose text matches ground truth', async () => {
    const [inv] = await sb.database.db.select().from(s.portalInvoices).where(eq(s.portalInvoices.invoiceNumber, 'ACM-1058'))
    const text = await pdfToText(inv!.pdf)
    expect(text).toContain('ACM-1058')
    expect(text).toContain('$4,812.50')
    expect(text).toContain('2026-10-28')
    const file = await readFile(join(sb.filesDir, 'Invoices/BL-22014.pdf'))
    expect(await pdfToText(file)).toContain('$7,420.00')
  })
})

describe('scenario seeds', () => {
  it('omits the due date from the PDF in missing_info', async () => {
    const sb = await createHeadlessSandbox('missing_info')
    try {
      const [inv] = await sb.database.db.select().from(s.portalInvoices).where(eq(s.portalInvoices.invoiceNumber, 'ACM-1058'))
      const text = await pdfToText(inv!.pdf)
      expect(text).not.toContain('Due date')
      expect(inv!.dueDate).toBeNull()
    } finally {
      await sb.close()
    }
  })

  it('seeds every scenario', async () => {
    for (const scenario of SCENARIOS) {
      const sb = await createHeadlessSandbox(scenario)
      await sb.close()
    }
  }, 60_000)
})
