import type { z } from 'zod'
import type { FocusTarget, Risk, ToolErrorCode, UserResponse } from '@shared/types'
import type { ScenarioId } from '@shared/scenarios'
import type { Db } from '../db/client'
import type { WriteLogEntry } from '../db/schema'
import type { Faults } from '../sandbox/faults'
import type { BrowserDriver } from '../browser/driver'
import type { LoadedPolicy } from '../agent/policy'
import type { Source } from '../agent/provenance'

/** A typed, expected tool failure. Returned to the model as an observation, never surfaced as a crash. */
export class ToolFailure extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ToolFailure'
  }
}

export interface ToolContext {
  db: Db
  filesDir: string
  faults: Faults
  browser: BrowserDriver
  portalUrl: string
  runId: string
  scenario: ScenarioId
  facts: string[]
  writes: WriteLogEntry[]
  /** Company policy as loaded from the sandbox's policy document for this step. */
  policy: LoadedPolicy
  /** Everything the worker has observed in this run, plus what the user said. Used for value provenance. */
  sources: Source[]
  /** Notifies the UI that the sandbox changed so it can refresh. */
  sandboxChanged(area: 'files' | 'mail' | 'finance'): void
}

export type RetryPolicy = 'none' | 'transient'

export type PendingRequestDraft =
  | { kind: 'question'; question: string; options?: string[] }
  | { kind: 'credentials'; site: string }
  | { kind: 'captcha' }

interface ToolBase<I extends z.ZodType, O> {
  name: string
  description: string
  input: I
  risk: Risk
  retry: RetryPolicy
  requiresApproval: boolean
  /** Error codes this tool can return. */
  errors: readonly ToolErrorCode[]
  /** What the Workspace shows while/after this tool runs. */
  focus?: (input: z.output<I>, output?: O) => FocusTarget
  /** Short human summary for the approval card (financial tools). */
  approval?: (input: z.output<I>, ctx: ToolContext) => { title: string; details: Record<string, unknown> }
  /** Amount at stake, compared with the policy's approval threshold (financial tools). */
  approvalAmount?: (input: z.output<I>, ctx: ToolContext) => Promise<number | null>
  /**
   * Runs before the policy decision: rejects impossible or policy-violating actions early, so the
   * user is never asked to approve something that would fail.
   */
  precheck?: (input: z.output<I>, ctx: ToolContext) => Promise<void>
}

/** Runs to completion in one step. Throw `ToolFailure` for expected errors. */
export interface ActionTool<I extends z.ZodType = z.ZodType, O = unknown> extends ToolBase<I, O> {
  kind: 'action'
  execute(input: z.output<I>, ctx: ToolContext): Promise<O>
}

/** Pauses the run until the user responds; then `complete` produces the observation. */
export interface InteractiveTool<I extends z.ZodType = z.ZodType, O = unknown> extends ToolBase<I, O> {
  kind: 'interactive'
  request(input: z.output<I>, ctx: ToolContext): Promise<PendingRequestDraft>
  complete(input: z.output<I>, response: UserResponse, ctx: ToolContext): Promise<O>
}

/** Ends the run. The runtime verifies before accepting. */
export interface TerminalTool<I extends z.ZodType = z.ZodType> extends ToolBase<I, never> {
  kind: 'terminal'
}

export type ToolDefinition<I extends z.ZodType = z.ZodType, O = unknown> = ActionTool<I, O> | InteractiveTool<I, O> | TerminalTool<I>

// Helpers that keep input inference while erasing to the registry's common type.
export function action<I extends z.ZodType, O>(def: Omit<ActionTool<I, O>, 'kind'>): ToolDefinition {
  return { ...def, kind: 'action' } as unknown as ToolDefinition
}
export function interactive<I extends z.ZodType, O>(def: Omit<InteractiveTool<I, O>, 'kind'>): ToolDefinition {
  return { ...def, kind: 'interactive' } as unknown as ToolDefinition
}
export function terminal<I extends z.ZodType>(def: Omit<TerminalTool<I>, 'kind'>): ToolDefinition {
  return { ...def, kind: 'terminal' } as unknown as ToolDefinition
}
