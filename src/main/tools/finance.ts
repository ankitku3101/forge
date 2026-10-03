import { z } from 'zod'
import { assertNotDuplicate, createRecord, getRecord, resolveVendor, searchRecords, updateRecord } from '../apps/finance'
import { formatMoney } from '../sandbox/pdf'
import { action } from './types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const status = z.enum(['unpaid', 'paid', 'overdue'])
const money = z.number().nonnegative().multipleOf(0.01, 'Use at most two decimals')

export const financeTools = [
  action({
    name: 'search_records',
    description: 'Search Finance ledger records (invoices Arcus owes). Filters are optional and combine with AND.',
    input: z.object({
      vendor: z.string().optional().describe('Vendor name fragment'),
      invoiceNumber: z.string().optional(),
      status: status.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: [],
    focus: (i) => ({ kind: 'records', query: [i.vendor, i.invoiceNumber, i.status].filter(Boolean).join(' ') }),
    async execute(input, ctx) {
      return { records: await searchRecords(ctx.db, input) }
    },
  }),

  action({
    name: 'get_record',
    description: 'Get one Finance record by id.',
    input: z.object({ id: z.number().int() }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: ['NOT_FOUND'],
    focus: ({ id }) => ({ kind: 'record', id }),
    async execute({ id }, ctx) {
      return getRecord(ctx.db, id)
    },
  }),

  action({
    name: 'create_record',
    description:
      'Create a Finance record for a vendor invoice. Requires user approval. Vendor + invoice number must be unique. Use dueDate null only if the invoice truly has none.',
    input: z.object({
      vendor: z.string().min(1).describe('Exact vendor name as in Finance'),
      invoiceNumber: z.string().min(1),
      amount: money.describe('Total amount, e.g. 1234.50'),
      currency: z.string().length(3).default('USD'),
      issueDate: isoDate.nullable(),
      dueDate: isoDate.nullable(),
      status: status.default('unpaid'),
      notes: z.string().max(1000).default(''),
    }),
    risk: 'financial',
    retry: 'transient',
    requiresApproval: true,
    errors: ['VALIDATION', 'NOT_FOUND', 'AMBIGUOUS', 'DUPLICATE_RECORD', 'TRANSIENT', 'PERMISSION_DENIED'],
    focus: (_i, out) => (out ? { kind: 'record', id: (out as { id: number }).id, changed: ['*'] } : { kind: 'records' }),
    approval: (i) => ({
      title: `Add ${i.vendor} invoice ${i.invoiceNumber} to Finance`,
      details: {
        Vendor: i.vendor,
        'Invoice no.': i.invoiceNumber,
        Amount: formatMoney(Math.round(i.amount * 100), i.currency),
        'Issue date': i.issueDate ?? '—',
        'Due date': i.dueDate ?? 'none',
        Status: i.status,
        ...(i.notes ? { Notes: i.notes } : {}),
      },
    }),
    async precheck(i, ctx) {
      await assertNotDuplicate(ctx.db, i.vendor, i.invoiceNumber)
    },
    async execute(i, ctx) {
      const rec = await createRecord(ctx.db, ctx.faults, i)
      ctx.writes.push({
        kind: 'record',
        tool: 'create_record',
        recordId: rec.id,
        submitted: { vendor: rec.vendorName, invoiceNumber: i.invoiceNumber, amount: i.amount, dueDate: i.dueDate, issueDate: i.issueDate, status: i.status },
      })
      ctx.sandboxChanged('finance')
      // Return identifiers only; verification re-reads the stored values independently.
      return { id: rec.id, vendor: rec.vendorName, invoiceNumber: rec.invoiceNumber, created: true }
    },
  }),

  action({
    name: 'update_record',
    description: 'Change fields on an existing Finance record. Requires user approval.',
    input: z.object({
      id: z.number().int(),
      amount: money.optional(),
      dueDate: isoDate.nullable().optional(),
      status: status.optional(),
      notes: z.string().max(1000).optional(),
    }),
    risk: 'financial',
    retry: 'transient',
    requiresApproval: true,
    errors: ['VALIDATION', 'NOT_FOUND', 'TRANSIENT', 'PERMISSION_DENIED'],
    focus: (i) => ({ kind: 'record', id: i.id, changed: Object.keys(i).filter((k) => k !== 'id') }),
    approval: ({ id, ...patch }) => ({
      title: `Update Finance record ${id}`,
      details: Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [k, k === 'amount' && typeof v === 'number' ? formatMoney(Math.round(v * 100)) : (v ?? 'none')]),
      ),
    }),
    async precheck({ id }, ctx) {
      await getRecord(ctx.db, id)
    },
    async execute({ id, ...patch }, ctx) {
      const rec = await updateRecord(ctx.db, ctx.faults, id, patch)
      const vendor = await resolveVendor(ctx.db, rec.vendorName)
      ctx.writes.push({
        kind: 'record',
        tool: 'update_record',
        recordId: rec.id,
        submitted: {
          vendor: vendor.name,
          invoiceNumber: rec.invoiceNumber,
          amount: patch.amount ?? rec.amount,
          dueDate: patch.dueDate !== undefined ? patch.dueDate : rec.dueDate,
          issueDate: rec.issueDate,
          status: patch.status ?? rec.status,
        },
      })
      ctx.sandboxChanged('finance')
      return { id: rec.id, updated: Object.keys(patch) }
    },
  }),
]
