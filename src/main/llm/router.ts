import { LLMError, type CompletionRequest, type CompletionResult, type LLMProvider } from './types'

export interface RouterOptions {
  primary: LLMProvider
  fallback?: LLMProvider | null
  /** How long to stay on the fallback after switching. */
  breakerMs?: number
  rateLimitRetries?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface WaitNotice {
  reason: string
  ms: number
  attempt: number
}

export interface FallbackNotice {
  from: string
  to: string
  reason: string
}

/**
 * Routes each decision to the primary model and falls back on infrastructure failures only:
 * - 429: retry primary with backoff, then switch.
 * - 5xx / timeout: switch after one retry.
 * - Malformed tool call twice in a row: use the fallback for that step.
 * After a switch, a circuit breaker keeps calls on the fallback for `breakerMs`.
 */
export class LLMRouter {
  private readonly primary: LLMProvider
  private readonly fallback: LLMProvider | null
  private readonly breakerMs: number
  private readonly rateLimitRetries: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private breakerUntil = 0

  constructor(opts: RouterOptions) {
    this.primary = opts.primary
    this.fallback = opts.fallback ?? null
    this.breakerMs = opts.breakerMs ?? 5 * 60_000
    this.rateLimitRetries = opts.rateLimitRetries ?? (opts.fallback ? 2 : 8)
    this.now = opts.now ?? Date.now
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  get primaryModel(): string {
    return this.primary.model
  }

  get hasFallback(): boolean {
    return this.fallback !== null
  }

  async complete(
    req: CompletionRequest,
    validate: (r: CompletionResult) => string | null,
    onFallback: (n: FallbackNotice) => void,
    onWait: (n: WaitNotice) => void = () => undefined,
  ): Promise<CompletionResult> {
    if (this.fallback && this.now() < this.breakerUntil) {
      return this.callValidated(this.fallback, req, validate)
    }

    let malformed = 0
    let rateLimited = 0
    let serverFailures = 0
    for (;;) {
      try {
        return await this.callValidated(this.primary, req, validate)
      } catch (err) {
        if (!(err instanceof LLMError)) throw err
        if (err.kind === 'aborted' || err.kind === 'auth' || err.kind === 'bad_request') throw err

        if (err.kind === 'malformed') {
          malformed += 1
          if (malformed < 2) continue
          if (!this.fallback) throw err
          onFallback({ from: this.primary.model, to: this.fallback.model, reason: 'malformed tool call twice in a row' })
          return this.callValidated(this.fallback, req, validate)
        }

        if (err.kind === 'rate_limit') {
          rateLimited += 1
          if (rateLimited <= this.rateLimitRetries) {
            // Token-per-minute windows refill gradually; a provider's tiny retry-after hint rarely suffices.
            const ms = Math.max(err.retryAfterMs ?? 0, Math.min(20_000, 2000 * 2 ** (rateLimited - 1)))
            onWait({ reason: 'rate limited by the model provider', ms, attempt: rateLimited })
            await this.sleep(ms)
            continue
          }
          return this.switchOver('rate limited', err, req, validate, onFallback)
        }

        // server or timeout
        serverFailures += 1
        if (serverFailures < 2) {
          await this.sleep(500)
          continue
        }
        return this.switchOver(err.kind === 'timeout' ? 'timeout' : 'server error', err, req, validate, onFallback)
      }
    }
  }

  private async switchOver(
    reason: string,
    err: LLMError,
    req: CompletionRequest,
    validate: (r: CompletionResult) => string | null,
    onFallback: (n: FallbackNotice) => void,
  ): Promise<CompletionResult> {
    if (!this.fallback) throw err
    this.breakerUntil = this.now() + this.breakerMs
    onFallback({ from: this.primary.model, to: this.fallback.model, reason })
    return this.callValidated(this.fallback, req, validate)
  }

  private async callValidated(
    provider: LLMProvider,
    req: CompletionRequest,
    validate: (r: CompletionResult) => string | null,
  ): Promise<CompletionResult> {
    const result = await provider.complete(req)
    const problem = validate(result)
    if (problem) throw new LLMError('malformed', problem)
    return result
  }
}
