# LLM Providers

Two providers behind one `LLMProvider` interface, both called through OpenAI-compatible APIs with the `openai` SDK.

| Role | Provider | Default model | Key |
|---|---|---|---|
| Primary | Groq | `openai/gpt-oss-120b` | `GROQ_API_KEY` (required) |
| Fallback | Google Gemini | `gemini-3.5-flash` | `GOOGLE_API_KEY` (optional) |

Gemini base URL: `https://generativelanguage.googleapis.com/v1beta/openai/`. A stable model, so it stays available through judging.

## When to fall back
- 429 rate limit: retry primary with backoff, then switch.
- 5xx or timeout: switch after one retry.
- Malformed tool call twice in a row: switch for that step.

Never fall back for a poor decision; the loop handles that.

## Mid-run switching
- History is stored in a provider-neutral format and converted per call, so either model can continue any run.
- **Circuit breaker:** after switching, stay on the fallback for 5 minutes before retrying the primary.
- Every step records which model decided it; the Activity panel shows a "switched to fallback" note.

## Rules
- One system prompt for both models.
- Evals report success rate per model.
- Final summaries mention if the fallback was used.
- No fallback key? The app runs on Groq alone.