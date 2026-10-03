import { z } from 'zod'
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
