import { z } from 'zod'
import type { BrowserDriver } from '../browser/driver'
import { uniqueName, writeSandboxFile } from '../sandbox/files'
import { action, ToolFailure, type ToolContext } from './types'

const ref = z.string().describe('Element ref from the latest snapshot, e.g. "e7"')

async function pageView(browser: BrowserDriver) {
  const snap = await browser.snapshot()
  return { url: snap.info.url, title: snap.info.title, snapshot: snap.text }
}

function resolvePortalUrl(ctx: ToolContext, url: string): string {
  let target: URL
  try {
    target = new URL(url, ctx.portalUrl)
  } catch {
    throw new ToolFailure('VALIDATION', `"${url}" is not a valid URL.`)
  }
  if (target.origin !== new URL(ctx.portalUrl).origin) {
    throw new ToolFailure('PERMISSION_DENIED', `Only the Arcus Vendor Portal (${ctx.portalUrl}) can be opened.`)
  }
  return target.href
}

export const browserTools = [
  action({
    name: 'browser_open',
    description: 'Open a page of the Arcus Vendor Portal in the browser. Accepts a full URL or a path like "/invoices". Returns a page snapshot.',
    input: z.object({ url: z.string().min(1) }),
    risk: 'read',
    retry: 'transient',
    requiresApproval: false,
    errors: ['VALIDATION', 'PERMISSION_DENIED', 'TRANSIENT', 'SESSION_EXPIRED'],
    focus: () => ({ kind: 'portal' }),
    async execute({ url }, ctx) {
      await ctx.browser.open(resolvePortalUrl(ctx, url))
      return pageView(ctx.browser)
    },
  }),

  action({
    name: 'browser_read',
    description: 'Snapshot the current browser page: text plus interactive elements tagged [kind "name" ref=eN]. Refs change after every page load.',
    input: z.object({}),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: [],
    focus: () => ({ kind: 'portal' }),
    async execute(_input, ctx) {
      return pageView(ctx.browser)
    },
  }),

  action({
    name: 'browser_click',
    description: 'Click a link or button by ref. Returns the resulting page snapshot.',
    input: z.object({ ref }),
    risk: 'read',
    retry: 'transient',
    requiresApproval: false,
    errors: ['VALIDATION', 'NOT_FOUND', 'TRANSIENT', 'SESSION_EXPIRED'],
    focus: () => ({ kind: 'portal' }),
    async execute({ ref: r }, ctx) {
      await ctx.browser.click(r)
      return pageView(ctx.browser)
    },
  }),

  action({
    name: 'browser_type',
    description: 'Type text into a text field by ref, optionally pressing Enter. Cannot be used for password or captcha fields.',
    input: z.object({ ref, text: z.string().max(500), submit: z.boolean().default(false) }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: ['VALIDATION', 'NOT_FOUND', 'PERMISSION_DENIED', 'SESSION_EXPIRED'],
    focus: () => ({ kind: 'portal' }),
    async execute({ ref: r, text, submit }, ctx) {
      await ctx.browser.type(r, text, submit)
      return pageView(ctx.browser)
    },
  }),

  action({
    name: 'browser_download',
    description: 'Download the file behind a link (by ref) into the Files app under Downloads/. Returns the saved path; use read_file to read it.',
    input: z.object({ ref }),
    risk: 'write',
    retry: 'transient',
    requiresApproval: false,
    errors: ['VALIDATION', 'NOT_FOUND', 'TRANSIENT', 'SESSION_EXPIRED', 'PERMISSION_DENIED'],
    focus: (_i, out) => (out ? { kind: 'file', path: (out as { path: string }).path } : { kind: 'portal' }),
    async execute({ ref: r }, ctx) {
      const file = await ctx.browser.download(r)
      const path = await uniqueName(ctx.filesDir, 'Downloads', file.filename)
      const res = await writeSandboxFile(ctx.filesDir, path, file.data)
      ctx.writes.push({ kind: 'file', tool: 'browser_download', path: res.path, sha256: res.sha256 })
      ctx.sandboxChanged('files')
      return { path: res.path, bytes: file.data.length, contentType: file.contentType }
    },
  }),
]
