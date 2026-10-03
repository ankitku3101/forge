import { describe, expect, it } from 'vitest'
import { LLMRouter, type FallbackNotice } from '../src/main/llm/router'
import { LLMError, type CompletionResult, type LLMProvider } from '../src/main/llm/types'

function provider(model: string, behaviour: (n: number) => 'ok' | 'malformed' | LLMError): LLMProvider & { calls: number } {
  return {
    id: model,
    model,
    calls: 0,
    async complete(): Promise<CompletionResult> {
      const b = behaviour(this.calls++)
      if (b instanceof LLMError) throw b
      return {
        message: { role: 'assistant', content: null, toolCalls: [{ id: 'x', name: b === 'ok' ? 'finish' : '???', arguments: '{}' }] },
        usage: { input: 1, output: 1 },
        provider: model,
        model,
      }
    },
  }
}

const validate = (r: CompletionResult) => (r.message.toolCalls?.[0]?.name === 'finish' ? null : 'unknown tool')
const noSleep = async () => undefined

describe('LLM router', () => {
  it('retries rate limits on the primary, then switches and holds the breaker', async () => {
    let now = 0
    const primary = provider('groq', () => new LLMError('rate_limit', '429'))
    const fallback = provider('gemini', () => 'ok')
    const notices: FallbackNotice[] = []
    const router = new LLMRouter({ primary, fallback, now: () => now, sleep: noSleep })

    const r = await router.complete({ messages: [], tools: [] }, validate, (n) => notices.push(n))
    expect(r.model).toBe('gemini')
    expect(primary.calls).toBe(3)
    expect(notices[0]?.reason).toBe('rate limited')

    await router.complete({ messages: [], tools: [] }, validate, () => undefined)
    expect(primary.calls).toBe(3) // breaker open

    now = 6 * 60_000
    await router.complete({ messages: [], tools: [] }, validate, () => undefined)
    expect(primary.calls).toBe(6) // breaker closed again
  })

  it('switches after one retry on server errors', async () => {
    const primary = provider('groq', () => new LLMError('server', '500'))
    const fallback = provider('gemini', () => 'ok')
    const r = await new LLMRouter({ primary, fallback, sleep: noSleep }).complete({ messages: [], tools: [] }, validate, () => undefined)
    expect(primary.calls).toBe(2)
    expect(r.model).toBe('gemini')
  })

  it('uses the fallback for one step after two malformed calls, without opening the breaker', async () => {
    const primary = provider('groq', (n) => (n < 2 ? 'malformed' : 'ok'))
    const fallback = provider('gemini', () => 'ok')
    const router = new LLMRouter({ primary, fallback, sleep: noSleep })
    expect((await router.complete({ messages: [], tools: [] }, validate, () => undefined)).model).toBe('gemini')
    expect((await router.complete({ messages: [], tools: [] }, validate, () => undefined)).model).toBe('groq')
  })

  it('never falls back on auth errors, and runs alone without a fallback', async () => {
    const primary = provider('groq', () => new LLMError('auth', '401'))
    const fallback = provider('gemini', () => 'ok')
    await expect(new LLMRouter({ primary, fallback, sleep: noSleep }).complete({ messages: [], tools: [] }, validate, () => undefined)).rejects.toThrow('401')

    const lonely = provider('groq', () => new LLMError('server', '500'))
    await expect(new LLMRouter({ primary: lonely, sleep: noSleep }).complete({ messages: [], tools: [] }, validate, () => undefined)).rejects.toThrow('500')
  })
})
