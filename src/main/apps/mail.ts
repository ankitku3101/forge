import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import type { MailMessage, MailSummary } from '@shared/types'
import type { Db } from '../db/client'
import { mail, mailAttachments } from '../db/schema'
import { ToolFailure } from '../tools/types'

const summaryColumns = {
  id: mail.id,
  fromName: mail.fromName,
  fromAddress: mail.fromAddress,
  subject: mail.subject,
  receivedAt: mail.receivedAt,
  hasAttachments: sql<boolean>`exists (select 1 from ${mailAttachments} where ${mailAttachments.mailId} = ${mail.id})`,
}

export async function searchMail(db: Db, q: { query?: string; from?: string; limit?: number }): Promise<MailSummary[]> {
  const where: SQL[] = []
  if (q.query) {
    const like = `%${q.query.trim()}%`
    where.push(or(ilike(mail.subject, like), ilike(mail.body, like), ilike(mail.fromName, like))!)
  }
  if (q.from) where.push(or(ilike(mail.fromName, `%${q.from}%`), ilike(mail.fromAddress, `%${q.from}%`))!)
  return db
    .select(summaryColumns)
    .from(mail)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(mail.receivedAt))
    .limit(q.limit ?? 50)
}

export async function getMail(db: Db, id: number): Promise<MailMessage> {
  const [m] = await db.select().from(mail).where(eq(mail.id, id))
  if (!m) throw new ToolFailure('NOT_FOUND', `Email ${id} does not exist.`)
  const atts = await db
    .select({ id: mailAttachments.id, filename: mailAttachments.filename, size: sql<number>`octet_length(${mailAttachments.content})` })
    .from(mailAttachments)
    .where(eq(mailAttachments.mailId, id))
  return {
    id: m.id,
    fromName: m.fromName,
    fromAddress: m.fromAddress,
    toAddress: m.toAddress,
    subject: m.subject,
    body: m.body,
    receivedAt: m.receivedAt,
    hasAttachments: atts.length > 0,
    attachments: atts.map((a) => ({ ...a, size: Number(a.size) })),
  }
}

export async function getAttachment(db: Db, mailId: number, attachmentId: number) {
  const [a] = await db
    .select()
    .from(mailAttachments)
    .where(and(eq(mailAttachments.mailId, mailId), eq(mailAttachments.id, attachmentId)))
  if (!a) throw new ToolFailure('NOT_FOUND', `Email ${mailId} has no attachment ${attachmentId}.`)
  return a
}
