/** Provider-neutral history. Stored in the DB and converted per call, so any model can continue any run. */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[]; model?: string }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface ToolCall {
  id: string
  name: string
  /** Raw JSON string as produced by the model. */
  arguments: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface CompletionRequest {
  messages: ChatMessage[]
  tools: ToolSpec[]
  signal?: AbortSignal
}

export interface CompletionResult {
  message: Extract<ChatMessage, { role: 'assistant' }>
  usage: { input: number; output: number }
  provider: string
  model: string
}

export interface LLMProvider {
  readonly id: string
  readonly model: string
  complete(req: CompletionRequest): Promise<CompletionResult>
}

export type LLMErrorKind = 'rate_limit' | 'server' | 'timeout' | 'auth' | 'bad_request' | 'malformed' | 'aborted'

export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}
