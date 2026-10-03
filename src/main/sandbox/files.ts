import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { extractText, getDocumentProxy } from 'unpdf'
import type { FileContent, FileEntry } from '@shared/types'
import { ToolFailure } from '../tools/types'

export const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json'])

/** Resolves a sandbox-relative path, refusing anything that escapes the Files folder. */
export function resolveSandboxPath(filesDir: string, path: string): string {
  const cleaned = path.replace(/\\/g, '/').replace(/^\/+/, '')
  const abs = resolve(filesDir, cleaned)
  const root = resolve(filesDir)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new ToolFailure('PERMISSION_DENIED', `Path "${path}" is outside the sandbox Files folder.`)
  }
  return abs
}

export function toSandboxPath(filesDir: string, abs: string): string {
  return relative(resolve(filesDir), abs).split(sep).join('/')
}

export async function listTree(filesDir: string, dir = ''): Promise<FileEntry[]> {
  const abs = resolveSandboxPath(filesDir, dir)
  let names: string[]
  try {
    names = await readdir(abs)
  } catch {
    throw new ToolFailure('NOT_FOUND', `Folder "${dir || '/'}" does not exist.`)
  }
  const out: FileEntry[] = []
  for (const name of names.sort()) {
    const full = join(abs, name)
    const st = await stat(full)
    const path = toSandboxPath(filesDir, full)
    if (st.isDirectory()) out.push({ path, name, type: 'dir', size: 0, children: await listTree(filesDir, path) })
    else out.push({ path, name, type: 'file', size: st.size })
  }
  return out
}

export function flattenTree(entries: FileEntry[]): FileEntry[] {
  return entries.flatMap((e) => (e.type === 'dir' ? [e, ...flattenTree(e.children ?? [])] : [e]))
}

export async function pdfToText(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(data))
  const { text } = await extractText(pdf, { mergePages: true })
  return text.replace(/[ \t]+/g, ' ').trim()
}

export async function readSandboxFile(filesDir: string, path: string): Promise<FileContent> {
  const abs = resolveSandboxPath(filesDir, path)
  let data: Buffer
  try {
    data = await readFile(abs)
  } catch {
    throw new ToolFailure('NOT_FOUND', `File "${path}" does not exist.`)
  }
  const rel = toSandboxPath(filesDir, abs)
  const ext = extname(abs).toLowerCase()
  if (ext === '.pdf') {
    return { path: rel, kind: 'pdf', text: await pdfToText(data), dataBase64: data.toString('base64') }
  }
  if (TEXT_EXTENSIONS.has(ext)) return { path: rel, kind: 'text', text: data.toString('utf8') }
  return { path: rel, kind: 'binary', size: data.length }
}

export async function writeSandboxFile(filesDir: string, path: string, data: string | Uint8Array): Promise<{ path: string; created: boolean; sha256: string }> {
  const abs = resolveSandboxPath(filesDir, path)
  const existed = await stat(abs).then(
    (s) => {
      if (s.isDirectory()) throw new ToolFailure('VALIDATION', `"${path}" is a folder.`)
      return true
    },
    () => false,
  )
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, data)
  return { path: toSandboxPath(filesDir, abs), created: !existed, sha256: sha256(typeof data === 'string' ? Buffer.from(data) : data) }
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Picks a free name in `dir` for `filename`, appending " (2)", " (3)"... like a browser does. */
export async function uniqueName(filesDir: string, dir: string, filename: string): Promise<string> {
  const safe = filename.replace(/[/\\:*?"<>|]+/g, '_')
  const ext = extname(safe)
  const base = safe.slice(0, safe.length - ext.length)
  for (let i = 1; ; i++) {
    const candidate = `${dir}/${i === 1 ? safe : `${base} (${i})${ext}`}`
    const exists = await stat(resolveSandboxPath(filesDir, candidate)).then(() => true, () => false)
    if (!exists) return candidate
  }
}
