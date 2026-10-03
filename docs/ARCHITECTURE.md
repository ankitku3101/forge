# Architecture

Electron app, TypeScript throughout. The agent runtime has no UI dependencies.

```
Renderer (React) ⇄ typed IPC ⇄ Main process
                                ├─ Agent runtime
                                ├─ Tools → PGlite · sandbox folder · browser driver
                                └─ Portal server (Express, localhost)
```

## Agent loop
observe → decide (LLM tool call) → validate (Zod) → policy check → execute → observe → persist → repeat.

**Run state (DB):** goal, messages, facts, status, pending request, step count.
**Statuses:** `running`, `awaiting_user`, `completed`, `failed`. Pausing stops the loop; the user's reply resumes it from saved state.
**Limits:** 30 steps; abort after 3 identical failing calls.

## Policy engine
read → auto · write → auto · financial → approval at or above the threshold · destructive → disabled.

Business rules live in the sandbox, not in code: a fenced `policy` block in `Files/Policies/approval-policy.md` sets `approval_threshold`, `missing_due_date` and `remit_account_mismatch`. It is re-read at every decision, so editing the document changes behavior immediately. A missing or invalid block falls back to the strictest defaults (everything needs approval) with a warning in Activity. Code keeps the invariants no document can loosen: destructive tools stay disabled and secrets never reach the model. Every financial decision emits a `policy_decision` event citing its source.

## Verification (code, not the model)
1. **Write check:** re-read the record, compare with submitted values.
2. **Outcome check:** compare with seeded ground truth.
Result: `verified`, `mismatch` or `unverifiable`.

## Events
`task_started`, `tool_called`, `tool_succeeded|failed`, `approval_requested`, `input_requested`, `verification_passed|failed`, `task_completed|failed`. Persisted and pushed to the renderer over IPC.

## Decisions
- **LLMs:** Groq primary, Gemini fallback, behind an `LLMProvider` interface (see `LLM.md`).
- **UI:** React with shadcn/ui components (Tailwind v4).
- **Portal:** Express 5, server-rendered HTML, cookie sessions.
- **PGlite + Drizzle:** real Postgres embedded; no install, isolated per user.
- **Browser driver interface:** in the app, Playwright over CDP controls the embedded portal view; in evals, Playwright launches headless Chromium.