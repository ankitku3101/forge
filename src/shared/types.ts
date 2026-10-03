import type { ScenarioId } from './scenarios'

export type RunStatus = 'running' | 'awaiting_user' | 'completed' | 'failed'

export type Risk = 'read' | 'write' | 'financial' | 'destructive'

export const TOOL_ERROR_CODES = [
  'NOT_FOUND',
  'VALIDATION',
  'DUPLICATE_RECORD',
  'TRANSIENT',
  'SESSION_EXPIRED',
  'AMBIGUOUS',
  'PERMISSION_DENIED',
] as const
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number]

/** What the Workspace panel shows while a tool runs. */
export type FocusTarget =
  | { kind: 'none' }
  | { kind: 'file'; path: string }
  | { kind: 'mail'; id: number }
  | { kind: 'record'; id: number; changed?: string[] }
  | { kind: 'records'; query?: string }
  | { kind: 'portal' }

export type PendingRequest =
  | { kind: 'approval'; toolCallId: string; tool: string; title: string; details: Record<string, unknown> }
  | { kind: 'question'; toolCallId: string; question: string; options?: string[] }
  | { kind: 'credentials'; toolCallId: string; site: string }
  | { kind: 'captcha'; toolCallId: string }

export type UserResponse =
  | { kind: 'approval'; approved: boolean; note?: string }
  | { kind: 'answer'; text: string }
  | { kind: 'credentials'; username: string; password: string }
  | { kind: 'captcha'; answer: string }
  /** The user typed credentials or the captcha directly into the live portal page. */
  | { kind: 'done_in_page' }

export type VerificationStatus = 'verified' | 'mismatch' | 'unverifiable'

export interface VerificationCheck {
  kind: 'write' | 'outcome'
  target: string
  status: VerificationStatus
  detail: string
}

export interface VerificationResult {
  status: VerificationStatus
  checks: VerificationCheck[]
}

export interface RunEventBase {
  runId: string
  seq: number
  at: string
}

export type RunEventPayload =
  | { type: 'task_started'; goal: string; scenario: ScenarioId }
  | { type: 'step_started'; step: number; model: string; provider: string }
  | { type: 'model_note'; text: string }
  | { type: 'llm_fallback'; from: string; to: string; reason: string }
  | { type: 'tool_called'; step: number; toolCallId: string; tool: string; input: unknown; risk: Risk }
  | { type: 'tool_retry'; toolCallId: string; tool: string; attempt: number; code: ToolErrorCode; message: string }
  | { type: 'tool_succeeded'; toolCallId: string; tool: string; output: unknown; durationMs: number }
  | { type: 'tool_failed'; toolCallId: string; tool: string; code: ToolErrorCode; message: string; durationMs: number }
  | { type: 'focus_changed'; focus: FocusTarget }
  | { type: 'approval_requested'; request: PendingRequest }
  | { type: 'input_requested'; request: PendingRequest }
  | { type: 'user_responded'; kind: PendingRequest['kind']; summary: string }
  | { type: 'status_changed'; status: RunStatus }
  | { type: 'verification_passed'; result: VerificationResult }
  | { type: 'verification_failed'; result: VerificationResult }
  | { type: 'task_completed'; summary: string; verification: VerificationResult; usedFallback: boolean }
  | { type: 'task_failed'; reason: string }

export type RunEvent = RunEventBase & RunEventPayload
export type RunEventType = RunEventPayload['type']

export interface RunInfo {
  id: string
  goal: string
  scenario: ScenarioId
  status: RunStatus
  stepCount: number
  pending: PendingRequest | null
  summary: string | null
  verification: VerificationResult | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface FileEntry {
  path: string
  name: string
  type: 'file' | 'dir'
  size: number
  children?: FileEntry[]
}

export type FileContent =
  | { path: string; kind: 'text'; text: string }
  | { path: string; kind: 'pdf'; text: string; dataBase64: string }
  | { path: string; kind: 'binary'; size: number }

export interface MailSummary {
  id: number
  fromName: string
  fromAddress: string
  subject: string
  receivedAt: string
  hasAttachments: boolean
}

export interface MailMessage extends MailSummary {
  toAddress: string
  body: string
  attachments: { id: number; filename: string; size: number }[]
}

export type RecordStatus = 'unpaid' | 'paid' | 'overdue'

export interface Vendor {
  id: number
  name: string
  email: string
}

export interface FinanceRecord {
  id: number
  vendorId: number
  vendorName: string
  invoiceNumber: string
  amount: number
  currency: string
  issueDate: string | null
  dueDate: string | null
  status: RecordStatus
  notes: string
  createdAt: string
  updatedAt: string
}

export interface AppState {
  scenario: ScenarioId
  /** Run that is running or waiting for the user. The sandbox is read-only while set. */
  activeRunId: string | null
  /** A run that was mid-step when the app last closed; it can be resumed. */
  interruptedRunId: string | null
  portalUrl: string
  hasPrimaryKey: boolean
  hasFallbackKey: boolean
  model: string
  fallbackModel: string
}
