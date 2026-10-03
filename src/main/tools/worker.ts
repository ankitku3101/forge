import { z } from 'zod'
import { traceFields } from '../agent/provenance'
import { interactive, action, terminal, ToolFailure } from './types'

export const finishInput = z.object({
  summary: z.string().min(1).max(4000).describe('What you did and what you found, for the user'),
  claims: z
    .object({
      records: z
        .array(z.object({ vendor: z.string(), invoiceNumber: z.string() }))
        .default([])
        .describe('Finance records you created or updated'),
      files: z.array(z.string()).default([]).describe('Files you wrote'),
    })
    .default({ records: [], files: [] }),
  outcome: z
    .enum(['done', 'blocked'])
    .default('done')
    .describe('"blocked" if the task cannot be completed (explain why in the summary)'),
})
export type FinishInput = z.output<typeof finishInput>

export const workerTools = [
  action({
    name: 'remember',
    description: 'Save a short fact to working memory (e.g. an invoice number or amount you found) so it stays visible for the rest of the task.',
    input: z.object({ fact: z.string().min(1).max(300) }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: [],
    async execute({ fact }, ctx) {
      ctx.facts.push(fact)
      return { remembered: ctx.facts.length }
    },
  }),

  action({
    name: 'track_items',
    description:
      'For tasks covering several items (e.g. "all unpaid invoices"), declare every item you found before working on them. Keys must be identifiers you saw in a source (e.g. invoice numbers). Call again to add items you discover later. Each item must then be resolved with resolve_item; finish is refused while any item is pending.',
    input: z.object({
      items: z.array(z.object({ key: z.string().min(1).max(60), description: z.string().max(200).default('') })).min(1).max(100),
    }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: ['VALIDATION'],
    async execute({ items }, ctx) {
      const res = traceFields(
        ctx.sources,
        items.map((i) => ({ name: i.key, label: 'Item', value: i.key, kind: 'token' as const })),
      )
      if (res.missing.length) {
        throw new ToolFailure('VALIDATION', `These items are not in anything you opened during this task: ${res.missing.join('; ')}.`)
      }
      for (const i of items) {
        if (ctx.worklist.some((w) => w.key.toUpperCase() === i.key.toUpperCase())) continue
        ctx.worklist.push({ key: i.key, description: i.description, status: 'pending', source: res.found[i.key] })
      }
      return { items: ctx.worklist.map(({ key, status }) => ({ key, status })) }
    },
  }),

  action({
    name: 'resolve_item',
    description: 'Mark a tracked item as done, or skipped with the reason (e.g. already recorded, blocked by policy, user said no).',
    input: z.object({
      key: z.string().min(1),
      status: z.enum(['done', 'skipped']),
      reason: z.string().max(500).default(''),
    }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: ['NOT_FOUND', 'VALIDATION'],
    async execute({ key, status, reason }, ctx) {
      const item = ctx.worklist.find((w) => w.key.toUpperCase() === key.trim().toUpperCase())
      if (!item) throw new ToolFailure('NOT_FOUND', `"${key}" is not a tracked item. Tracked: ${ctx.worklist.map((w) => w.key).join(', ') || 'none'}.`)
      if (status === 'skipped' && reason.trim().length < 5) throw new ToolFailure('VALIDATION', 'Skipping an item needs a reason.')
      item.status = status
      if (reason) item.reason = reason
      const pending = ctx.worklist.filter((w) => w.status === 'pending').map((w) => w.key)
      return { key: item.key, status, pending }
    },
  }),

  interactive({
    name: 'ask_user',
    description: 'Ask the user a clarifying question when the task is ambiguous or information is missing. Offer short options when possible. Pauses until they answer.',
    input: z.object({ question: z.string().min(1).max(500), options: z.array(z.string().min(1).max(100)).max(6).optional() }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: [],
    async request({ question, options }) {
      return { kind: 'question', question, ...(options?.length ? { options } : {}) }
    },
    async complete(_input, response) {
      if (response.kind !== 'answer') throw new ToolFailure('VALIDATION', 'No answer was given.')
      return { answer: response.text }
    },
  }),

  interactive({
    name: 'request_credentials',
    description:
      'Ask the user to sign in on the current sign-in page. The user supplies the username and password; they are entered into the form for you and never shown to you. Open the sign-in page first.',
    input: z.object({ site: z.string().min(1).max(100) }),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: ['VALIDATION'],
    async request({ site }, ctx) {
      if (!(await ctx.browser.hasLoginForm())) throw new ToolFailure('VALIDATION', 'The current page has no sign-in form. Open the sign-in page first.')
      return { kind: 'credentials', site }
    },
    async complete(_input, response, ctx) {
      if (response.kind === 'done_in_page') return { status: 'entered_by_user_in_page' }
      if (response.kind !== 'credentials') throw new ToolFailure('VALIDATION', 'No credentials were provided.')
      await ctx.browser.fillLogin(response.username, response.password)
      return { status: 'provided', next: 'Credentials are filled in. Complete the captcha if the form has one, then submit the form.' }
    },
  }),

  interactive({
    name: 'request_captcha',
    description: 'Ask the user to solve the captcha on the current page. Their answer is entered into the captcha field for you.',
    input: z.object({}),
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: ['VALIDATION'],
    async request(_input, ctx) {
      if (!(await ctx.browser.hasCaptcha())) throw new ToolFailure('VALIDATION', 'The current page has no captcha.')
      return { kind: 'captcha' }
    },
    async complete(_input, response, ctx) {
      if (response.kind === 'done_in_page') return { status: 'entered_by_user_in_page' }
      if (response.kind !== 'captcha') throw new ToolFailure('VALIDATION', 'No captcha answer was provided.')
      await ctx.browser.fillCaptcha(response.answer)
      return { status: 'provided', next: 'The captcha answer is filled in. Submit the form.' }
    },
  }),

  terminal({
    name: 'finish',
    description:
      'End the task with a summary for the user and the records/files you changed. Your claims are independently verified before the task is marked done.',
    input: finishInput,
    risk: 'read',
    retry: 'none',
    requiresApproval: false,
    errors: [],
  }),
]
