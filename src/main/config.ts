import { GEMINI_BASE_URL, GROQ_BASE_URL, OpenAICompatibleProvider } from './llm/openai-compatible'
import { LLMRouter } from './llm/router'

export interface LLMConfig {
  groqKey: string | null
  googleKey: string | null
  model: string
  fallbackModel: string
  maxSteps: number
}

export function loadLLMConfig(env: NodeJS.ProcessEnv = process.env): LLMConfig {
  const maxSteps = Number(env.MAX_STEPS)
  return {
    groqKey: env.GROQ_API_KEY?.trim() || null,
    googleKey: env.GOOGLE_API_KEY?.trim() || null,
    model: env.MODEL?.trim() || 'openai/gpt-oss-120b',
    fallbackModel: env.FALLBACK_MODEL?.trim() || 'gemini-3.5-flash',
    maxSteps: Number.isInteger(maxSteps) && maxSteps > 0 ? maxSteps : 30,
  }
}

/** Builds the router; `forceFallback` makes Gemini the only provider (used by `pnpm eval --model fallback`). */
export function createRouter(cfg: LLMConfig, opts: { forceFallback?: boolean } = {}): LLMRouter {
  const gemini = cfg.googleKey
    ? new OpenAICompatibleProvider({ id: 'gemini', apiKey: cfg.googleKey, baseURL: GEMINI_BASE_URL, model: cfg.fallbackModel })
    : null
  if (opts.forceFallback) {
    if (!gemini) throw new Error('GOOGLE_API_KEY is required to run on the fallback model')
    return new LLMRouter({ primary: gemini })
  }
  if (!cfg.groqKey) throw new Error('GROQ_API_KEY is not set. Add it to .env or in Settings.')
  const groq = new OpenAICompatibleProvider({ id: 'groq', apiKey: cfg.groqKey, baseURL: GROQ_BASE_URL, model: cfg.model })
  return new LLMRouter({ primary: groq, fallback: gemini })
}
