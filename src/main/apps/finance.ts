import { and, asc, desc, eq, ilike, type SQL } from 'drizzle-orm'
import type { FinanceRecord, RecordStatus, Vendor } from '@shared/types'
import type { Db } from '../db/client'
import { financeRecords, vendors } from '../db/schema'
import type { Faults } from '../sandbox/faults'
import { ToolFailure } from '../tools/types'

/** The Finance-side faults. Manual edits from the UI use `NO_FAULTS`. */
export type FinanceFaults = Pick<Faults, 'storedAmountCents' | 'takeFinanceCreateFailure'>
export const NO_FAULTS: FinanceFaults = { storedAmountCents: (c) => c, takeFinanceCreateFailure: () => false }

export const toCents = (amount: number) => Math.round(amount * 100)
export const fromCents = (cents: number) => cents / 100

const columns = {
  id: financeRecords.id,
  vendorId: financeRecords.vendorId,
  vendorName: vendors.name,
  invoiceNumber: financeRecords.invoiceNumber,
  amountCents: financeRecords.amountCents,
  currency: financeRecords.currency,
  issueDate: financeRecords.issueDate,
  dueDate: financeRecords.dueDate,
  status: financeRecords.status,
  notes: financeRecords.notes,
  createdAt: financeRecords.createdAt,
  updatedAt: financeRecords.updatedAt,
}

function toRecord(r: Omit<FinanceRecord, 'amount'> & { amountCents: number }): FinanceRecord {
  const { amountCents, ...rest } = r
  return { ...rest, amount: fromCents(amountCents) }
}

export async function listVendors(db: Db): Promise<Vendor[]> {
  return db.select().from(vendors).orderBy(asc(vendors.name))
}

/** Exact (case-insensitive) match first; otherwise a unique partial match; otherwise NOT_FOUND / AMBIGUOUS. */
export async function resolveVendor(db: Db, name: string): Promise<Vendor> {
  const all = await listVendors(db)
  const q = name.trim().toLowerCase()
  const exact = all.find((v) => v.name.toLowerCase() === q)
  if (exact) return exact
  const partial = all.filter((v) => v.name.toLowerCase().includes(q))
  if (partial.length === 1) return partial[0]!
  if (partial.length > 1) {
    throw new ToolFailure('AMBIGUOUS', `"${name}" matches several vendors: ${partial.map((v) => v.name).join('; ')}. Use the exact vendor name.`)
  }
  throw new ToolFailure('NOT_FOUND', `No vendor named "${name}". Known vendors: ${all.map((v) => v.name).join('; ')}.`)
}

export interface RecordQuery {
  vendor?: string
  invoiceNumber?: string
  status?: RecordStatus
  limit?: number
}

export async function searchRecords(db: Db, q: RecordQuery): Promise<FinanceRecord[]> {
  const where: SQL[] = []
  if (q.vendor) where.push(ilike(vendors.name, `%${q.vendor.trim()}%`))
  if (q.invoiceNumber) where.push(ilike(financeRecords.invoiceNumber, `%${q.invoiceNumber.trim()}%`))
  if (q.status) where.push(eq(financeRecords.status, q.status))
  const rows = await db
    .select(columns)
    .from(financeRecords)
    .innerJoin(vendors, eq(vendors.id, financeRecords.vendorId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(financeRecords.issueDate), desc(financeRecords.id))
    .limit(q.limit ?? 50)
  return rows.map(toRecord)
}

export async function getRecord(db: Db, id: number): Promise<FinanceRecord> {
  const [row] = await db.select(columns).from(financeRecords).innerJoin(vendors, eq(vendors.id, financeRecords.vendorId)).where(eq(financeRecords.id, id))
  if (!row) throw new ToolFailure('NOT_FOUND', `Finance record ${id} does not exist.`)
  return toRecord(row)
}

export interface NewRecord {
  vendor: string
  invoiceNumber: string
  amount: number
  currency: string
  issueDate: string | null
  dueDate: string | null
  status: RecordStatus
  notes: string
}

async function findExisting(db: Db, vendorId: number, invoiceNumber: string) {
  const [row] = await db
    .select({ id: financeRecords.id })
    .from(financeRecords)
    .where(and(eq(financeRecords.vendorId, vendorId), ilike(financeRecords.invoiceNumber, invoiceNumber.trim())))
  return row ?? null
}

/** Throws DUPLICATE_RECORD if this vendor + invoice number is already in Finance. */
export async function assertNotDuplicate(db: Db, vendor: string, invoiceNumber: string): Promise<void> {
  const v = await resolveVendor(db, vendor)
  const existing = await findExisting(db, v.id, invoiceNumber)
  if (existing) {
    throw new ToolFailure('DUPLICATE_RECORD', `${v.name} invoice ${invoiceNumber} is already in Finance as record ${existing.id}.`)
  }
}

export async function createRecord(db: Db, faults: FinanceFaults, input: NewRecord): Promise<FinanceRecord> {
  const v = await resolveVendor(db, input.vendor)
  if (faults.takeFinanceCreateFailure()) {
    throw new ToolFailure('TRANSIENT', 'Finance service is temporarily unavailable (HTTP 503).')
  }
  const invoiceNumber = input.invoiceNumber.trim()
  const existing = await findExisting(db, v.id, invoiceNumber)
  if (existing) throw new ToolFailure('DUPLICATE_RECORD', `${v.name} invoice ${invoiceNumber} is already in Finance as record ${existing.id}.`)
  try {
    const [row] = await db
      .insert(financeRecords)
      .values({
        vendorId: v.id,
        invoiceNumber,
        amountCents: faults.storedAmountCents(toCents(input.amount)),
        currency: input.currency,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        status: input.status,
        notes: input.notes,
      })
      .returning({ id: financeRecords.id })
    return getRecord(db, row!.id)
  } catch (err) {
    if (isUniqueViolation(err)) throw new ToolFailure('DUPLICATE_RECORD', `${v.name} invoice ${invoiceNumber} is already in Finance.`)
    throw err
  }
}

export interface RecordPatch {
  amount?: number
  dueDate?: string | null
  status?: RecordStatus
  notes?: string
}

export async function updateRecord(db: Db, faults: FinanceFaults, id: number, patch: RecordPatch): Promise<FinanceRecord> {
  await getRecord(db, id)
  const values: Partial<typeof financeRecords.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (patch.amount !== undefined) values.amountCents = faults.storedAmountCents(toCents(patch.amount))
  if (patch.dueDate !== undefined) values.dueDate = patch.dueDate
  if (patch.status !== undefined) values.status = patch.status
  if (patch.notes !== undefined) values.notes = patch.notes
  await db.update(financeRecords).set(values).where(eq(financeRecords.id, id))
  return getRecord(db, id)
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err
  while (e && typeof e === 'object') {
    if ((e as { code?: string }).code === '23505') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}
