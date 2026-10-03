# CLAUDE.md

**Project:** Autonomous AI Worker, an Electron app where an AI worker completes tasks inside a fictional company, Arcus, while the user watches.

Read first: `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/TOOLS.md`.

## Rules
- TypeScript (strict) only.
- The LLM decides *what* to do. Code decides validity, permission, execution and verification.
- Never hardcode task workflows (no `if task includes "invoice"`). Add capabilities as tools.
- Every tool: Zod input, typed output, typed error codes, risk level, retry policy.
- Credentials and captcha answers never enter LLM context, logs or the DB.
- Every state change emits a structured event.
- Persist run state after every step; runs must be resumable.
- The renderer never touches the DB or agent directly, only typed IPC.
- Prefer deterministic code over prompts. Prompts live in `src/main/agent/prompts/`.
- No fake features.

## Commands
- `pnpm dev`: run the app
- `pnpm seed`: rebuild sandbox data
- `pnpm eval`: run scenarios headlessly
- `pnpm build`: package installers
- `pnpm test`, `pnpm typecheck`, `pnpm lint`: run before finishing any task

## Layout
`src/main/` agent, tools, db, portal server · `src/renderer/` UI · `src/shared/` types and IPC contracts · `seed/` fixtures.

Changing agent behavior? Add or update an eval case.