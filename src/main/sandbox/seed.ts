import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { faker } from '@faker-js/faker'
import type { PGlite } from '@electric-sql/pglite'
import type { ScenarioId } from '@shared/scenarios'
import type { Db } from '../db/client'
import { recreateSandboxTables } from '../db/client'
import * as s from '../db/schema'
import { fixturesFor, invoiceTotalCents } from './fixtures'
import { renderInvoicePdf } from './pdf'
import { hashPassword } from '../portal/auth'

export interface SeedTarget {
  pg: PGlite
  db: Db
  filesDir: string
}

/** Bump when sandbox tables change shape; the app reseeds a sandbox built by an older version. */
export const SANDBOX_SCHEMA_VERSION = 2

export const SANDBOX_DIRS =['Invoices', 'Policies', 'Notes', 'Downloads'] as const

/** Rebuilds every sandbox table and the Files folder for `scenario`. Deterministic. */
export async function buildSandbox({ pg, db, filesDir }: SeedTarget, scenario: ScenarioId): Promise<void> {
  const f = fixturesFor(scenario)
  await recreateSandboxTables(pg)

  const vendorIds = new Map<string, number>()
  for (const v of f.vendors) {
    const [row] = await db.insert(s.vendors).values({ name: v.name, email: v.email, remitAccount: v.remitAccount }).returning({ id: s.vendors.id })
    vendorIds.set(v.name, row!.id)
  }

  const pdfs = new Map<string, Uint8Array>()
  for (const inv of f.portalInvoices) {
    const pdf = await renderInvoicePdf(inv, f)
    pdfs.set(inv.invoiceNumber, pdf)
    await db.insert(s.portalInvoices).values({
      vendorName: inv.vendor,
      invoiceNumber: inv.invoiceNumber,
      amountCents: invoiceTotalCents(inv),
      currency: inv.currency,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
      description: inv.description,
      pdf,
    })
  }

  for (const u of f.portalUsers) {
    await db.insert(s.portalUsers).values({ username: u.username, passwordHash: hashPassword(u.password, u.username), displayName: u.displayName })
  }

  for (const rec of f.financeRecords) {
    const inv = f.portalInvoices.find((i) => i.invoiceNumber === rec.invoiceNumber)
    const vendorId = vendorIds.get(rec.vendor)
    if (!inv || vendorId === undefined) throw new Error(`Finance fixture ${rec.invoiceNumber} has no matching invoice/vendor`)
    await db.insert(s.financeRecords).values({
      vendorId,
      invoiceNumber: rec.invoiceNumber,
      amountCents: invoiceTotalCents(inv),
      currency: inv.currency,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: rec.status,
      remitAccount: inv.remitAccount ?? f.vendors.find((v) => v.name === rec.vendor)!.remitAccount,
      notes: rec.notes,
      createdAt: `${inv.issueDate}T12:00:00Z`,
      updatedAt: `${inv.issueDate}T12:00:00Z`,
    })
  }

  for (const m of f.mail) {
    const [row] = await db
      .insert(s.mail)
      .values({ fromName: m.fromName, fromAddress: m.fromAddress, toAddress: f.company.apEmail, subject: m.subject, body: m.body, receivedAt: m.receivedAt })
      .returning({ id: s.mail.id })
    for (const a of m.attachments ?? []) {
      const pdf = pdfs.get(a.invoice)
      if (!pdf) throw new Error(`Mail attachment references unknown invoice ${a.invoice}`)
      await db.insert(s.mailAttachments).values({ mailId: row!.id, filename: `${a.invoice}.pdf`, content: pdf })
    }
  }

  faker.seed(20261003)
  for (let i = 0; i < f.fillerMailCount; i++) {
    const first = faker.person.firstName()
    const last = faker.person.lastName()
    const topic = faker.helpers.arrayElement([
      `Team lunch on ${faker.date.weekday()}`,
      `Re: ${faker.company.catchPhrase()}`,
      `${faker.commerce.department()} budget review`,
      `Out of office: ${first} ${last}`,
      `Quarterly ${faker.company.buzzNoun()} update`,
    ])
    await db.insert(s.mail).values({
      fromName: `${first} ${last}`,
      fromAddress: faker.internet.email({ firstName: first, lastName: last, provider: 'arcus.example' }).toLowerCase(),
      toAddress: f.company.apEmail,
      subject: topic,
      body: `${faker.lorem.paragraphs(2, '\n\n')}\n\n${first}`,
      receivedAt: faker.date.between({ from: '2026-09-01T00:00:00Z', to: '2026-10-02T23:00:00Z' }).toISOString(),
    })
  }

  await db.insert(s.sandboxMeta).values([
    { key: 'scenario', value: scenario },
    { key: 'schemaVersion', value: SANDBOX_SCHEMA_VERSION },
  ])

  await rm(filesDir, { recursive: true, force: true })
  for (const d of SANDBOX_DIRS) await mkdir(join(filesDir, d), { recursive: true })
  for (const file of f.files) {
    await mkdir(dirname(join(filesDir, file.path)), { recursive: true })
    await writeFile(join(filesDir, file.path), file.content, 'utf8')
  }
  for (const pf of f.invoicePdfFiles) {
    const pdf = pdfs.get(pf.invoice)
    if (!pdf) throw new Error(`File fixture references unknown invoice ${pf.invoice}`)
    await writeFile(join(filesDir, pf.path), pdf)
  }
}
