import { extname } from 'node:path'
import { z } from 'zod'
import { flattenTree, listTree, readSandboxFile, TEXT_EXTENSIONS, writeSandboxFile } from '../sandbox/files'
import { extractCheckableValues, traceFields } from '../agent/provenance'
import { action, ToolFailure, type ToolContext } from './types'

const MAX_TEXT = 20_000

/** Every amount, date and invoice-like identifier in written text must trace to an observed source. */
function traceContent(ctx: ToolContext, content: string): Record<string, string> {
  const res = traceFields(ctx.sources, extractCheckableValues(content))
  if (res.missing.length) {
    throw new ToolFailure('VALIDATION', `These values are not in anything you opened during this task: ${res.missing.join('; ')}. Only write values you have read from a source.`)
  }
  return res.found
}

export const fileTools = [
  action({
    name: 'list_files',
    description: 'List files and folders in the Arcus shared drive (Files app), recursively. Paths are relative, e.g. "Invoices/BL-22014.pdf".',
    input: z.object({ dir: z.string().optional().describe('Folder to list, e.g. "Invoices". Omit for the whole drive.') }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: ['NOT_FOUND', 'PERMISSION_DENIED'],
    async execute({ dir }, ctx) {
      const entries = flattenTree(await listTree(ctx.filesDir, dir ?? ''))
      return { entries: entries.map((e) => ({ path: e.path, type: e.type, size: e.size })) }
    },
  }),

  action({
    name: 'read_file',
    description: 'Read a file from the Files app. Text files return their content; PDFs return extracted text.',
    input: z.object({ path: z.string().min(1) }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: ['NOT_FOUND', 'VALIDATION', 'PERMISSION_DENIED'],
    focus: ({ path }) => ({ kind: 'file', path }),
    async execute({ path }, ctx) {
      const file = await readSandboxFile(ctx.filesDir, path)
      if (file.kind === 'binary') throw new ToolFailure('VALIDATION', `"${path}" is not a text or PDF file.`)
      const truncated = file.text.length > MAX_TEXT
      return { path: file.path, kind: file.kind, text: truncated ? file.text.slice(0, MAX_TEXT) : file.text, truncated }
    },
  }),

  action({
    name: 'search_files',
    description: 'Search file names and contents (including PDF text) in the Files app. Case-insensitive.',
    input: z.object({ query: z.string().min(1) }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: [],
    async execute({ query }, ctx) {
      const q = query.toLowerCase()
      const files = flattenTree(await listTree(ctx.filesDir)).filter((e) => e.type === 'file')
      const results: { path: string; nameMatch: boolean; lines: string[] }[] = []
      for (const f of files) {
        const content = await readSandboxFile(ctx.filesDir, f.path)
        const text = content.kind === 'binary' ? '' : content.text
        const lines = text.split(/\r?\n/).filter((l) => l.toLowerCase().includes(q)).slice(0, 5).map((l) => l.trim().slice(0, 200))
        const nameMatch = f.path.toLowerCase().includes(q)
        if (nameMatch || lines.length) results.push({ path: f.path, nameMatch, lines })
      }
      return { results }
    },
  }),

  action({
    name: 'write_file',
    description: 'Create or overwrite a text file (.md, .txt, .csv, .json) in the Files app, e.g. "Notes/summary.md".',
    input: z.object({ path: z.string().min(1), content: z.string().max(200_000) }),
    risk: 'write',
    retry: 'none',
    requiresApproval: false,
    errors: ['VALIDATION', 'PERMISSION_DENIED'],
    focus: ({ path }) => ({ kind: 'file', path }),
    async precheck({ content }, ctx) {
      traceContent(ctx, content)
    },
    async execute({ path, content }, ctx) {
      if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
        throw new ToolFailure('VALIDATION', 'Only .md, .txt, .csv and .json files can be written.')
      }
      const provenance = traceContent(ctx, content)
      const res = await writeSandboxFile(ctx.filesDir, path, content)
      ctx.writes.push({ kind: 'file', tool: 'write_file', path: res.path, sha256: res.sha256, provenance })
      ctx.sandboxChanged('files')
      return { path: res.path, created: res.created, bytes: Buffer.byteLength(content) }
    },
  }),
]
