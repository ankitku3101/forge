import { z } from 'zod'
import { assertNotDuplicate, createRecord, getRecord, resolveVendor, searchRecords, updateRecord } from '../apps/finance'
import { formatMoney } from '../sandbox/pdf'
import type { LoadedPolicy } from '../agent/policy'
import { traceFields, type Field } from '../agent/provenance'
import { action, ToolFailure, type ToolContext } from './types'

const UNSOURCED = 'Not found in anything you opened during this task'

/**
 * Every value written to Finance must come from an observed source. The amount and dates must sit
 * in the same source as the invoice number (e.g. the invoice PDF), unless the user stated them.
 */
function traceNewRecord(ctx: ToolContext, i: { vendor: string; invoiceNumber: string; amount: number; issueDate: string | null; dueDate: string | null }) {
  const fields: Field[] = [
    { name: 'vendor', label: 'Vendor', value: i.vendor, kind: 'text' },
    { name: 'invoiceNumber', label: 'Invoice number', value: i.invoiceNumber, kind: 'token' },
    { name: 'amount', label: 'Amount', value: i.amount, kind: 'amount' },
    ...(i.issueDate ? [{ name: 'issueDate', label: 'Issue date', value: i.issueDate, kind: 'date' as const }] : []),
    ...(i.dueDate ? [{ name: 'dueDate', label: 'Due date', value: i.dueDate, kind: 'date' as const }] : []),
  ]
  return requireTrace(ctx, fields)
}

function traceUpdate(ctx: ToolContext, invoiceNumber: string, patch: { amount?: number; dueDate?: string | null }) {
  const fields: Field[] = [
    { name: 'invoiceNumber', label: 'Invoice number', value: invoiceNumber, kind: 'token' },
    ...(patch.amount !== undefined ? [{ name: 'amount', label: 'Amount', value: patch.amount, kind: 'amount' as const }] : []),
    ...(patch.dueDate ? [{ name: 'dueDate', label: 'Due date', value: patch.dueDate, kind: 'date' as const }] : []),
  ]
  return requireTrace(ctx, fields)
}

function requireTrace(ctx: ToolContext, fields: Field[]): Record<string, string> {
  const res = traceFields(ctx.sources, fields, { anchor: 'invoiceNumber', anchored: ['amount', 'issueDate', 'dueDate'] })
  if (res.missing.length) {
    throw new ToolFailure('VALIDATION', `${UNSOURCED}: ${res.missing.join('; ')}. Open the source document (or ask the user) and use its exact values.`)
  }
  return res.found
}

/** Applies the document policy's `missing_due_date` rule. */
function checkMissingDueDate({ policy, source }: LoadedPolicy, notes: string): void {
  if (policy.missing_due_date === 'block') {
    throw new ToolFailure('PERMISSION_DENIED', `Policy (${source}) does not allow saving an invoice without a due date. Ask the user how to proceed.`)
  }
  if (policy.missing_due_date === 'note' && notes.trim().length < 5) {
    throw new ToolFailure('VALIDATION', `Policy (${source}) requires a note explaining the missing due date.`)
  }
}

const isoDate =z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
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
    approval: (i, ctx) => {
      const p = traceNewRecord(ctx, i)
      const src = (f: string) => (p[f] ? `  ← ${p[f]}` : '')
      return {
        title: `Add ${i.vendor} invoice ${i.invoiceNumber} to Finance`,
        details: {
          Vendor: i.vendor + src('vendor'),
          'Invoice no.': i.invoiceNumber + src('invoiceNumber'),
          Amount: formatMoney(Math.round(i.amount * 100), i.currency) + src('amount'),
          'Issue date': (i.issueDate ?? '—') + src('issueDate'),
          'Due date': (i.dueDate ?? 'none') + src('dueDate'),
          Status: i.status,
          ...(i.notes ? { Notes: i.notes } : {}),
        },
      }
    },
    approvalAmount: async (i) => i.amount,
    async precheck(i, ctx) {
      await assertNotDuplicate(ctx.db, i.vendor, i.invoiceNumber)
      traceNewRecord(ctx, i)
      if (i.dueDate === null) checkMissingDueDate(ctx.policy, i.notes)
    },
    async execute(i, ctx) {
      const provenance = traceNewRecord(ctx, i)
      const rec = await createRecord(ctx.db, ctx.faults, i)
      ctx.writes.push({
        kind: 'record',
        tool: 'create_record',
        recordId: rec.id,
        submitted: { vendor: rec.vendorName, invoiceNumber: i.invoiceNumber, amount: i.amount, dueDate: i.dueDate, issueDate: i.issueDate, status: i.status },
        provenance,
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
    approvalAmount: async (i, ctx) => i.amount ?? (await getRecord(ctx.db, i.id)).amount,
    async precheck(i, ctx) {
      const rec = await getRecord(ctx.db, i.id)
      traceUpdate(ctx, rec.invoiceNumber, i)
      if (i.dueDate === null && rec.dueDate !== null) checkMissingDueDate(ctx.policy, i.notes ?? rec.notes)
    },
    async execute({ id, ...patch }, ctx) {
      const provenance = traceUpdate(ctx, (await getRecord(ctx.db, id)).invoiceNumber, patch)
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
        provenance,
      })
      ctx.sandboxChanged('finance')
      return { id: rec.id, updated: Object.keys(patch) }
    },
  }),
]
