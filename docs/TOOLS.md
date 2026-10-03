# Tools

Registered in `src/main/tools/registry.ts`. The model sees only registered tools, never the raw DB or apps.

## Definition
`name`, `description`, `input` (Zod), `output` type, `errors`, `risk` (read | write | financial | destructive), `retry` (none | transient ×2 with backoff), `requiresApproval`, `focus` (what the Workspace shows).

## Files
`list_files`, `read_file` (text/PDF), `search_files`, `write_file`

## Mail
`search_mail`, `open_mail`, `download_attachment`

## Finance
`search_records`, `get_record`, `create_record` (financial), `update_record` (financial)

## Browser (Arcus Vendor Portal)
`browser_open`, `browser_read` (accessibility snapshot with element refs), `browser_click`, `browser_type`, `browser_download`

## Worker
`remember(fact)`, `ask_user(question, options?)`, `request_credentials(site)`, `request_captcha()`, `finish(summary, claims)`

## Errors
`NOT_FOUND`, `VALIDATION`, `DUPLICATE_RECORD` (DB unique on vendor + invoice no.), `TRANSIENT` (auto-retried), `SESSION_EXPIRED`, `AMBIGUOUS`, `PERMISSION_DENIED`. Returned to the model as observations, never thrown.

## Secrets
`request_credentials` and `request_captcha` pause the run. The user answers in a secure chat form, or types directly into the live portal page. The harness fills the fields; the model only sees "provided" or "login succeeded".