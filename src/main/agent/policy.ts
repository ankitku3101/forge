import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Risk } from '@shared/types'
import { resolveSandboxPath } from '../sandbox/files'

export const POLICY_FILE = 'Policies/approval-policy.md'

/**
 * Company policy, loaded from a fenced ```policy block in the sandbox's policy document so the
 * rules live with the business, not in code. Code keeps the invariants a document cannot loosen:
 * destructive tools stay disabled and secrets never reach the model.
 */
export const policySchema = z.object({
  /** Financial writes with an amount at or above this need user approval; smaller ones run automatically. */
  approval_threshold: z.number().nonnegative(),
  /** What to do when an invoice has no due date: `block` (ask the user), `note` (allowed with an explaining note), `allow`. */
  missing_due_date: z.enum(['block', 'note', 'allow']),
  /** What to do when an invoice's remit-to account differs from the vendor record. */
  remit_account_mismatch: z.enum(['block', 'approve', 'allow']),
})
export type Policy = z.infer<typeof policySchema>

/** Used when the document is missing or invalid: everything needs approval, nothing risky is allowed. */
export const STRICTEST_POLICY: Policy = { approval_threshold: 0, missing_due_date: 'block', remit_account_mismatch: 'block' }

export interface LoadedPolicy {
  policy: Policy
  source: string
  warning: string | null
}

export async function loadPolicy(filesDir: string): Promise<LoadedPolicy> {
  let text: string
  try {
    text = await readFile(resolveSandboxPath(filesDir, POLICY_FILE), 'utf8')
  } catch {
    return { policy: STRICTEST_POLICY, source: 'built-in strictest defaults', warning: `${POLICY_FILE} not found; using the strictest defaults.` }
  }
  return parsePolicyDocument(text)
}

export function parsePolicyDocument(text: string): LoadedPolicy {
  const block = /```policy\s*\n([\s\S]*?)```/.exec(text)?.[1]
  if (!block) return { policy: STRICTEST_POLICY, source: 'built-in strictest defaults', warning: `${POLICY_FILE} has no \`\`\`policy block; using the strictest defaults.` }
  const parsed = policySchema.safeParse(parseKeyValues(block))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return { policy: STRICTEST_POLICY, source: 'built-in strictest defaults', warning: `${POLICY_FILE} policy block is invalid (${issues}); using the strictest defaults.` }
  }
  return { policy: parsed.data, source: POLICY_FILE, warning: null }
}

/** Minimal `key: value` parser (a YAML subset): numbers, booleans and bare strings; `#` starts a comment. */
function parseKeyValues(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    out[key] = value === 'true' ? true : value === 'false' ? false : value !== '' && !Number.isNaN(Number(value.replace(/_/g, ''))) ? Number(value.replace(/_/g, '')) : value
  }
  return out
}

export type PolicyDecision = { decision: 'auto' | 'approval' | 'deny'; reason: string }

/**
 * read → auto · write → auto · financial → approval at or above the document's threshold ·
 * destructive → always disabled.
 */
export function decide(tool: { risk: Risk; requiresApproval: boolean }, amount: number | null, loaded: LoadedPolicy): PolicyDecision {
  const { policy, source } = loaded
  switch (tool.risk) {
    case 'destructive':
      return { decision: 'deny', reason: 'Destructive actions are disabled.' }
    case 'financial': {
      const threshold = policy.approval_threshold
      if (amount !== null && amount < threshold) {
        return { decision: 'auto', reason: `${fmt(amount)} is below the ${fmt(threshold)} approval threshold (${source}).` }
      }
      return {
        decision: 'approval',
        reason: amount === null ? `Financial change needs approval (${source}).` : `${fmt(amount)} is at or above the ${fmt(threshold)} approval threshold (${source}).`,
      }
    }
    case 'read':
    case 'write':
      return tool.requiresApproval ? { decision: 'approval', reason: 'This tool always needs approval.' } : { decision: 'auto', reason: 'No approval needed.' }
  }
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
