import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { getAttachment, getMail, searchMail } from '../apps/mail'
import { resolveSandboxPath, sha256, uniqueName, writeSandboxFile } from '../sandbox/files'
import { action } from './types'

export const mailTools = [
  action({
    name: 'search_mail',
    description: 'Search the Arcus AP inbox. Matches subject, body and sender. Newest first. Omit both filters to list recent mail.',
    input: z.object({
      query: z.string().optional(),
      from: z.string().optional().describe('Sender name or address fragment'),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: [],
    async execute(input, ctx) {
      return { messages: await searchMail(ctx.db, { ...input, limit: input.limit ?? 15 }) }
    },
  }),

  action({
    name: 'open_mail',
    description: 'Open one email by id: full body and attachment list.',
    input: z.object({ id: z.number().int() }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: ['NOT_FOUND'],
    focus: ({ id }) => ({ kind: 'mail', id }),
    async execute({ id }, ctx) {
      return getMail(ctx.db, id)
    },
  }),

  action({
    name: 'download_attachment',
    description: 'Save an email attachment into the Files app under Downloads/. Returns the saved path; use read_file to read it.',
    input: z.object({ mailId: z.number().int(), attachmentId: z.number().int() }),
    risk: 'write',
    retry: 'none',
    requiresApproval: false,
    errors: ['NOT_FOUND'],
    focus: (_input, out) => (out ? { kind: 'file', path: (out as { path: string }).path } : { kind: 'none' }),
    async execute({ mailId, attachmentId }, ctx) {
      const att = await getAttachment(ctx.db, mailId, attachmentId)
      const existing = `Downloads/${att.filename}`
      const same = await readFile(resolveSandboxPath(ctx.filesDir, existing)).then(
        (buf) => sha256(buf) === sha256(att.content),
        () => false,
      )
      const path = same ? existing : await uniqueName(ctx.filesDir, 'Downloads', att.filename)
      const res = await writeSandboxFile(ctx.filesDir, path, att.content)
      ctx.writes.push({ kind: 'file', tool: 'download_attachment', path: res.path, sha256: res.sha256 })
      ctx.sandboxChanged('files')
      return { path: res.path, bytes: att.content.length }
    },
  }),
]
