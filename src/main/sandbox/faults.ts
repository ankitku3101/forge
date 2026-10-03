import { z } from 'zod'
import type { ScenarioId } from '@shared/scenarios'

/**
 * Injected faults. They live outside the agent runtime: the agent only ever sees their effects
 * (an HTTP 503, a TRANSIENT error, an expired session, a rounded amount).
 *
 * Manual configuration: set `ARCUS_FAULTS` to a JSON object of `FaultConfig` fields to layer
 * extra faults over any scenario, e.g. `ARCUS_FAULTS={"portalLatencyMs":800,"portalAlternateLayout":true}`.
 */
export const faultConfigSchema = z.object({
  /** Number of `create_record` calls that fail with TRANSIENT before succeeding. */
  financeCreateTransientFailures: z.number().int().nonnegative().default(0),
  /** Finance silently rounds saved amounts to whole units. */
  financeRoundAmounts: z.boolean().default(false),
  /** The portal answers its first request with 503. */
  portal503FirstRequest: z.boolean().default(false),
  /** Added latency on every portal response. */
  portalLatencyMs: z.number().int().nonnegative().default(0),
  /** Kill the session once, on the Nth authenticated portal request after login. */
  portalExpireSessionAfter: z.number().int().positive().nullable().default(null),
  /** Serve the invoice list as cards instead of a table. */
  portalAlternateLayout: z.boolean().default(false),
})
export type FaultConfig = z.infer<typeof faultConfigSchema>

const SCENARIO_FAULTS: Record<ScenarioId, Partial<FaultConfig>> = {
  happy_path: {},
  transient_error: { financeCreateTransientFailures: 1 },
  duplicate: {},
  ambiguous_vendor: {},
  missing_info: {},
  session_expired: { portalExpireSessionAfter: 3 },
  verification_mismatch: { financeRoundAmounts: true },
}

function envOverrides(): Partial<FaultConfig> {
  const raw = process.env.ARCUS_FAULTS
  if (!raw) return {}
  try {
    return faultConfigSchema.partial().parse(JSON.parse(raw))
  } catch {
    console.warn('[faults] ignoring invalid ARCUS_FAULTS')
    return {}
  }
}

/** Fault state for one sandbox. Counters reset at the start of every run. */
export class Faults {
  config: FaultConfig
  private financeCreateFailuresLeft = 0
  private portalFirstRequestServed = false
  private authedRequestsSinceLogin = 0
  private sessionExpiryUsed = false

  constructor(scenario: ScenarioId, overrides: Partial<FaultConfig> = envOverrides()) {
    this.config = faultConfigSchema.parse({ ...SCENARIO_FAULTS[scenario], ...overrides })
    this.reset()
  }

  reset(): void {
    this.financeCreateFailuresLeft = this.config.financeCreateTransientFailures
    this.portalFirstRequestServed = false
    this.authedRequestsSinceLogin = 0
    this.sessionExpiryUsed = false
  }

  takeFinanceCreateFailure(): boolean {
    if (this.financeCreateFailuresLeft <= 0) return false
    this.financeCreateFailuresLeft -= 1
    return true
  }

  storedAmountCents(submittedCents: number): number {
    return this.config.financeRoundAmounts ? Math.round(submittedCents / 100) * 100 : submittedCents
  }

  takePortal503(): boolean {
    if (!this.config.portal503FirstRequest || this.portalFirstRequestServed) return false
    this.portalFirstRequestServed = true
    return true
  }

  onPortalLogin(): void {
    this.authedRequestsSinceLogin = 0
  }

  /** Called on each authenticated portal request; true means expire the session now. */
  shouldExpireSession(): boolean {
    const after = this.config.portalExpireSessionAfter
    if (after === null || this.sessionExpiryUsed) return false
    this.authedRequestsSinceLogin += 1
    if (this.authedRequestsSinceLogin < after) return false
    this.sessionExpiryUsed = true
    return true
  }
}
