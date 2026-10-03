import type { ChatMessage, CompletionRequest, CompletionResult, LLMProvider } from '../../src/main/llm/types'

export type Step = { tool: string; args?: Record<string, unknown> } | ((messages: ChatMessage[]) => { tool: string; args?: Record<string, unknown> })

/** Deterministic stand-in for a model in tests: replays a script of tool calls. */
export class ScriptedProvider implements LLMProvider {
  readonly id = 'scripted'
  readonly model = 'scripted-model'
  calls = 0
  private n = 0

  constructor(private readonly steps: Step[]) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const step = this.steps[this.calls]
    this.calls += 1
    if (!step) throw new Error(`Script exhausted after ${this.steps.length} steps`)
    const { tool, args } = typeof step === 'function' ? step(req.messages) : step
    this.n += 1
    return {
      message: { role: 'assistant', content: null, toolCalls: [{ id: `call_${this.n}`, name: tool, arguments: JSON.stringify(args ?? {}) }], model: this.model },
      usage: { input: 10, output: 5 },
      provider: this.id,
      model: this.model,
    }
  }
}

/** Last tool observation in the history, parsed. */
export function lastObservation(messages: ChatMessage[]): { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } {
  const m = [...messages].reverse().find((x) => x.role === 'tool')
  if (!m || m.role !== 'tool') throw new Error('No observation yet')
  return JSON.parse(m.content)
}

/** Finds the ref of the first element in a snapshot line matching `pattern`. */
export function refFor(snapshot: string, pattern: RegExp): string {
  const line = snapshot.split('\n').find((l) => pattern.test(l))
  const ref = line && /ref=(e\d+)/.exec(line.slice(line.search(pattern)))?.[1]
  if (!ref) throw new Error(`No ref matching ${pattern} in snapshot:\n${snapshot}`)
  return ref
}
