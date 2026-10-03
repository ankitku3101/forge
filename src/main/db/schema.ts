import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import type { PendingRequest, RunEventPayload, RunStatus, VerificationResult } from '@shared/types'
import type { ScenarioId } from '@shared/scenarios'
import type { ChatMessage } from '../llm/types'

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
})

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

// ---------- Arcus internal apps (visible to Finance and Mail tools) ----------

export const vendors = pgTable('vendors', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  email: text('email').notNull(),
  /** Bank account on file; invoices asking to pay elsewhere are a fraud signal. */
  remitAccount: text('remit_account').notNull(),
})

export const financeRecords = pgTable(
  'finance_records',
  {
    id: serial('id').primaryKey(),
    vendorId: integer('vendor_id')
      .notNull()
      .references(() => vendors.id),
    invoiceNumber: text('invoice_number').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    status: text('status').$type<'unpaid' | 'paid' | 'overdue'>().notNull(),
    remitAccount: text('remit_account'),
    notes: text('notes').notNull().default(''),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('finance_records_vendor_invoice').on(t.vendorId, t.invoiceNumber)],
)

export const mail = pgTable('mail', {
  id: serial('id').primaryKey(),
  fromName: text('from_name').notNull(),
  fromAddress: text('from_address').notNull(),
  toAddress: text('to_address').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  receivedAt: ts('received_at').notNull(),
})

export const mailAttachments = pgTable('mail_attachments', {
  id: serial('id').primaryKey(),
  mailId: integer('mail_id')
    .notNull()
    .references(() => mail.id),
  filename: text('filename').notNull(),
  content: bytea('content').notNull(),
})

// ---------- Harness (never exposed to the model) ----------

export const runs = pgTable('runs', {
  id: text('id').primaryKey(),
  goal: text('goal').notNull(),
  scenario: text('scenario').$type<ScenarioId>().notNull(),
  status: text('status').$type<RunStatus>().notNull(),
  messages: jsonb('messages').$type<ChatMessage[]>().notNull(),
  facts: jsonb('facts').$type<string[]>().notNull(),
  pending: jsonb('pending').$type<PendingRequest | null>(),
  stepCount: integer('step_count').notNull().default(0),
  writes: jsonb('writes').$type<WriteLogEntry[]>().notNull(),
  finishAttempts: integer('finish_attempts').notNull().default(0),
  usedFallback: boolean('used_fallback').notNull().default(false),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  summary: text('summary'),
  verification: jsonb('verification').$type<VerificationResult | null>(),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

export const runEvents = pgTable('run_events', {
  id: serial('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id),
  seq: integer('seq').notNull(),
  type: text('type').$type<RunEventPayload['type']>().notNull(),
  data: jsonb('data').$type<RunEventPayload>().notNull(),
  at: ts('at').notNull().defaultNow(),
})

export const sandboxMeta = pgTable('sandbox_meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
})

/** A write the worker made during a run, used by verification. */
export type WriteLogEntry =
  | {
      kind: 'record'
      tool: string
      recordId: number
      submitted: { vendor: string; invoiceNumber: string; amount: number; dueDate: string | null; issueDate: string | null; status: string }
      /** field → label of the source the value was traced to */
      provenance: Record<string, string>
    }
  | { kind: 'file'; tool: string; path: string; sha256: string; provenance?: Record<string, string> }

// ---------- Arcus Vendor Portal (separate schema; Finance tools never query it) ----------

export const portal = pgSchema('portal')

export const portalUsers = portal.table('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
})

export const portalInvoices = portal.table('invoices', {
  id: serial('id').primaryKey(),
  vendorName: text('vendor_name').notNull(),
  invoiceNumber: text('invoice_number').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull(),
  issueDate: date('issue_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  status: text('status').$type<'unpaid' | 'paid' | 'overdue'>().notNull(),
  description: text('description').notNull(),
  pdf: bytea('pdf').notNull(),
})
