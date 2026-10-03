import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import { LLMError, type ChatMessage, type CompletionRequest, type CompletionResult, type LLMProvider } from './types'

export interface OpenAICompatibleOptions {
  id: string
  apiKey: string
  baseURL: string
  model: string
  timeoutMs?: number
}

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'

/** Groq and Gemini both speak the OpenAI chat-completions dialect; one adapter covers both. */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string
  readonly model: string
  private readonly client: OpenAI

  constructor(opts: OpenAICompatibleOptions) {
    this.id = opts.id
    this.model = opts.model
    // Retries and fallback are owned by the router, not the SDK.
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 0, timeout: opts.timeoutMs ?? 60_000 })
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const tools: ChatCompletionTool[] = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
    let response: OpenAI.Chat.Completions.ChatCompletion
    try {
      response = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: req.messages.map(toOpenAI),
          tools,
          tool_choice: 'required',
          parallel_tool_calls: false,
          temperature: 0.2,
        },
        { signal: req.signal },
      )
    } catch (err) {
      throw classify(err)
    }
    const choice = response.choices[0]
    if (!choice) throw new LLMError('malformed', 'Response had no choices')
    const toolCalls = (choice.message.tool_calls ?? []).flatMap((tc) =>
      tc.type === 'function' ? [{ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }] : [],
    )
    return {
      message: {
        role: 'assistant',
        content: choice.message.content ?? null,
        ...(toolCalls.length ? { toolCalls } : {}),
        model: this.model,
      },
      usage: { input: response.usage?.prompt_tokens ?? 0, output: response.usage?.completion_tokens ?? 0 },
      provider: this.id,
      model: this.model,
    }
  }
}

function toOpenAI(m: ChatMessage): ChatCompletionMessageParam {
  switch (m.role) {
    case 'system':
    case 'user':
      return { role: m.role, content: m.content }
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      }
  }
}

function classify(err: unknown): LLMError {
  if (err instanceof OpenAI.APIUserAbortError) return new LLMError('aborted', 'Request aborted')
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new LLMError('timeout', 'Request timed out')
  if (err instanceof OpenAI.APIConnectionError) return new LLMError('server', `Connection error: ${err.message}`)
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 0
    if (status === 429) {
      const retryAfter = Number(err.headers?.get('retry-after'))
      return new LLMError('rate_limit', err.message, Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined)
    }
    if (status === 401 || status === 403) return new LLMError('auth', err.message)
    if (status >= 500) return new LLMError('server', err.message)
    // Groq reports unparseable tool calls as 400 "tool_use_failed", and a text-only reply under
    // tool_choice "required" as "model did not call a tool". Both are malformed decisions, not bad requests.
    if (status === 400 && /tool_use_failed|failed to call a function|tool call validation|did not call a tool|tool choice is required/i.test(err.message)) {
      return new LLMError('malformed', err.message)
    }
    return new LLMError('bad_request', err.message)
  }
  return new LLMError('server', err instanceof Error ? err.message : String(err))
}
