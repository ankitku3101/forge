import { z } from 'zod'
import { SCENARIOS } from './scenarios'
import type {
  AppState,
  FileContent,
  FileEntry,
  FinanceRecord,
  MailMessage,
  MailSummary,
  RunEvent,
  RunInfo,
  Vendor,
} from './types'

const userResponse = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approval'), approved: z.boolean(), note: z.string().max(500).optional() }),
  z.object({ kind: z.literal('answer'), text: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal('credentials'), username: z.string().min(1).max(200), password: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('captcha'), answer: z.string().min(1).max(20) }),
  z.object({ kind: z.literal('done_in_page') }),
])

const bounds = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })

/** Input schemas for every renderer → main call. Main validates with these before acting. */
export const ipcInputs = {
  'app:state': z.void(),
  'app:setScenario': z.object({ scenario: z.enum(SCENARIOS) }),
  'app:setApiKey': z.object({ provider: z.enum(['groq', 'google']), key: z.string().max(400) }),
  'sandbox:reset': z.void(),
  'files:list': z.void(),
  'files:read': z.object({ path: z.string().min(1).max(500) }),
  'files:write': z.object({ path: z.string().min(1).max(500), text: z.string().max(1_000_000) }),
  'mail:list': z.void(),
  'mail:get': z.object({ id: z.number().int() }),
  'finance:list': z.void(),
  'finance:update': z.object({
    id: z.number().int(),
    patch: z.object({
      amount: z.number().nonnegative().optional(),
      dueDate: z.string().nullable().optional(),
      status: z.enum(['unpaid', 'paid', 'overdue']).optional(),
      notes: z.string().max(2000).optional(),
    }),
  }),
  'run:start': z.object({ task: z.string().min(1).max(4000) }),
  'run:respond': z.object({ runId: z.string(), response: userResponse }),
  'run:cancel': z.object({ runId: z.string() }),
  'run:resume': z.object({ runId: z.string() }),
  'run:list': z.void(),
  'run:events': z.object({ runId: z.string() }),
  'run:captcha': z.object({ runId: z.string() }),
  'portal:setBounds': z.object({ bounds: bounds.nullable() }),
} as const

export interface IpcOutputs {
  'app:state': AppState
  'app:setScenario': AppState
  'app:setApiKey': AppState
  'sandbox:reset': AppState
  'files:list': FileEntry[]
  'files:read': FileContent
  'files:write': void
  'mail:list': MailSummary[]
  'mail:get': MailMessage
  'finance:list': { vendors: Vendor[]; records: FinanceRecord[] }
  'finance:update': FinanceRecord
  'run:start': { runId: string }
  'run:respond': void
  'run:cancel': void
  'run:resume': void
  'run:list': RunInfo[]
  'run:events': RunEvent[]
  /** SVG markup of the captcha currently shown on the portal login page. */
  'run:captcha': { svg: string | null }
  'portal:setBounds': void
}

export type IpcChannel = keyof typeof ipcInputs
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcInputs)[C]>

/** Main → renderer pushes. */
export interface IpcPushes {
  'run:event': RunEvent
  'run:updated': RunInfo
  'sandbox:changed': { area: 'files' | 'mail' | 'finance' | 'all' }
}
export type IpcPushChannel = keyof IpcPushes

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface ArcusApi {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcInput<C> extends void ? [] : [IpcInput<C>]
  ): Promise<IpcOutputs[C]>
  on<C extends IpcPushChannel>(channel: C, listener: (payload: IpcPushes[C]) => void): () => void
}
