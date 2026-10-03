export const SCENARIOS = [
  'happy_path',
  'transient_error',
  'duplicate',
  'ambiguous_vendor',
  'missing_info',
  'session_expired',
  'verification_mismatch',
] as const

export type ScenarioId = (typeof SCENARIOS)[number]

export const SCENARIO_INFO: Record<ScenarioId, { label: string; description: string }> = {
  happy_path: { label: 'Happy path', description: 'No injected faults.' },
  transient_error: { label: 'Transient error', description: 'The first Finance write fails with a temporary error.' },
  duplicate: { label: 'Duplicate', description: 'The invoice is already recorded in Finance.' },
  ambiguous_vendor: { label: 'Ambiguous vendor', description: 'Two Acme vendors have unpaid invoices.' },
  missing_info: { label: 'Missing info', description: 'The invoice PDF has no due date.' },
  session_expired: { label: 'Session expired', description: 'The portal logs the worker out mid-task.' },
  verification_mismatch: { label: 'Verification mismatch', description: 'Finance silently rounds saved amounts.' },
}

export function isScenario(value: unknown): value is ScenarioId {
  return typeof value === 'string' && (SCENARIOS as readonly string[]).includes(value)
}
