# Evals

`pnpm eval` runs each case headlessly (agent runtime + PGlite + portal server + headless Chromium, no UI) in a freshly seeded sandbox, then checks the **final DB state**, never the agent's own claims.

## Case format
```ts
{
  id, scenario, task,
  autoRespond: { approval: "approve", ask_user: "Acme Supplies", credentials: "demo", captcha: "fixture" },
  expect: { status: "completed", records: [...], mustAsk?: true, maxSteps: 25 }
}
```

## Cases
1. Happy path: portal invoice → Finance
2. Transient error → retried, one record
3. Duplicate → recognized, no second record
4. Ambiguous vendor → asks, then correct record
5. Missing due date → asks or flags
6. Session expired → re-requests login, completes
7. Verification mismatch → reported, not claimed done
8. Generalization: "List overdue invoices and save a summary to `Notes/overdue.md`"

## Metrics
Per case: pass/fail, steps, retries, tokens, cost, duration.
Summary: success rate overall, with faults enabled, and per model (`pnpm eval --model fallback` forces Gemini).

Each case runs 3× to account for LLM nondeterminism. Results go to `evals/results/<date>.json`; the latest table is linked from the README.