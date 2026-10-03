import { z } from 'zod'
import type { ScenarioId } from '@shared/scenarios'
import raw from '../../../seed/fixtures.json'

const status = z.enum(['unpaid', 'paid', 'overdue'])

const lineItem = z.object({ description: z.string(), quantity: z.number().positive(), unitPrice: z.number().nonnegative() })

const portalInvoice = z.object({
  vendor: z.string(),
  invoiceNumber: z.string(),
  currency: z.string(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  status,
  description: z.string(),
  lineItems: z.array(lineItem).min(1),
  /** Override the vendor's bank details printed on the invoice (fraud scenarios). */
  bank: z.string().optional(),
  remitAccount: z.string().optional(),
  /** Invisible text rendered into the PDF (prompt-injection scenarios). */
  hiddenNote: z.string().optional(),
})

const mailFixture = z.object({
  fromName: z.string(),
  fromAddress: z.string(),
  subject: z.string(),
  receivedAt: z.string(),
  body: z.string(),
  attachments: z.array(z.object({ invoice: z.string() })).optional(),
})

const financeRecord = z.object({
  vendor: z.string(),
  invoiceNumber: z.string(),
  status,
  notes: z.string(),
})

const fixturesSchema = z.object({
  company: z.object({ name: z.string(), address: z.string(), apEmail: z.string() }),
  vendors: z.array(z.object({ name: z.string(), email: z.string(), address: z.string(), bank: z.string(), remitAccount: z.string() })),
  portalUsers: z.array(z.object({ username: z.string(), password: z.string(), displayName: z.string() })),
  portalInvoices: z.array(portalInvoice),
  financeRecords: z.array(financeRecord),
  mail: z.array(mailFixture),
  fillerMailCount: z.number().int().nonnegative(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  invoicePdfFiles: z.array(z.object({ path: z.string(), invoice: z.string() })),
  scenarios: z.record(
    z.string(),
    z.object({
      addFinanceRecords: z.array(financeRecord).optional(),
      patchPortalInvoices: z
        .array(portalInvoice.partial().extend({ invoiceNumber: z.string() }))
        .optional(),
      addMail: z.array(mailFixture).optional(),
    }),
  ),
  groundTruth: z.object({
    files: z.record(z.string(), z.object({ mustMention: z.array(z.string()) })),
  }),
})

export type Fixtures = z.infer<typeof fixturesSchema>
export type PortalInvoiceFixture = z.infer<typeof portalInvoice>
export type FinanceRecordFixture = z.infer<typeof financeRecord>

const base = fixturesSchema.parse(raw)

export function invoiceTotalCents(inv: Pick<PortalInvoiceFixture, 'lineItems'>): number {
  return inv.lineItems.reduce((sum, li) => sum + Math.round(li.quantity * li.unitPrice * 100), 0)
}

/** Fixtures with the scenario's data changes applied. Pure and deterministic. */
export function fixturesFor(scenario: ScenarioId): Fixtures {
  const f: Fixtures = structuredClone(base)
  const patch = f.scenarios[scenario]
  if (!patch) return f
  for (const p of patch.patchPortalInvoices ?? []) {
    const target = f.portalInvoices.find((i) => i.invoiceNumber === p.invoiceNumber)
    if (!target) throw new Error(`Scenario ${scenario} patches unknown invoice ${p.invoiceNumber}`)
    Object.assign(target, p)
  }
  f.financeRecords.push(...(patch.addFinanceRecords ?? []))
  f.mail.push(...(patch.addMail ?? []))
  return f
}

export interface InvoiceTruth {
  vendor: string
  invoiceNumber: string
  amountCents: number
  issueDate: string
  dueDate: string | null
  status: 'unpaid' | 'paid' | 'overdue'
}

/** Ground truth used by outcome verification. Never shown to the model. */
export function groundTruthFor(scenario: ScenarioId) {
  const f = fixturesFor(scenario)
  const invoices = new Map<string, InvoiceTruth>()
  for (const inv of f.portalInvoices) {
    invoices.set(truthKey(inv.vendor, inv.invoiceNumber), {
      vendor: inv.vendor,
      invoiceNumber: inv.invoiceNumber,
      amountCents: invoiceTotalCents(inv),
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
    })
  }
  return { invoices, files: f.groundTruth.files }
}

export function truthKey(vendor: string, invoiceNumber: string): string {
  return `${vendor.trim().toLowerCase()}|${invoiceNumber.trim().toUpperCase()}`
}
