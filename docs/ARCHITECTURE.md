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

## Value provenance (enforced before every write)
Every value the worker writes must trace to something it observed in this run: a document, page, email or record it opened, or something the user said (the task or an answer). Sources are derived from persisted history, so the check survives restarts and works on any data.
- Finance writes: vendor, invoice number, amount and dates must each be found. Amount and dates must appear in the **same source** as the invoice number (e.g. the invoice PDF), unless the user stated them. This stops a coincidental number elsewhere from passing.
- File writes: every amount, ISO date and invoice-like identifier in the content must be traceable.
- Matching is format-tolerant ($4,812.50 = 4812.5; 2026-10-28 = Oct 28, 2026) but exact on value.
- Unsourced values are rejected with `VALIDATION` before approval is requested. The approval card shows where each value came from.
- Known limit: values the worker computes (e.g. summing line items) have no single source and are rejected; it must use the printed total or ask.

## Verification (code, not the model)
1. **Write check:** re-read the record or file, compare with what was submitted.
2. **Provenance check:** lists each value's source (recorded at write time).
3. **Ground-truth check (sandbox only):** compare with seeded fixtures. An oracle for evals; it can flag a mismatch, but its absence never makes a result unverifiable.
Result: `verified`, `mismatch` or `unverifiable`.

## Events
`task_started`, `tool_called`, `tool_succeeded|failed`, `approval_requested`, `input_requested`, `verification_passed|failed`, `task_completed|failed`. Persisted and pushed to the renderer over IPC.

## Decisions
- **LLMs:** Groq primary, Gemini fallback, behind an `LLMProvider` interface (see `LLM.md`).
- **UI:** React with shadcn/ui components (Tailwind v4).
- **Portal:** Express 5, server-rendered HTML, cookie sessions.
- **PGlite + Drizzle:** real Postgres embedded; no install, isolated per user.
- **Browser driver interface:** in the app, Playwright over CDP controls the embedded portal view; in evals, Playwright launches headless Chromium.