# Setup

## Requirements
Node 20+ and pnpm. No database or Docker needed.

## Run from source
```bash
git clone <repo-url> && cd autonomous-ai-worker
pnpm install
cp .env.example .env    # add GROQ_API_KEY
pnpm seed
pnpm dev
```

## Installers
Download from GitHub Releases (macOS, Windows, Linux). Builds are unsigned:
- **macOS:** right-click the app → Open, or run `xattr -cr "Autonomous AI Worker.app"`
- **Windows:** SmartScreen → More info → Run anyway

Demo builds include a spend-capped API key. Replace it in **Settings** with your own; it's stored with Electron `safeStorage`.

## Using the app
1. Pick a scenario, or keep `happy_path`.
2. Type a task or click an example.
3. Portal login: `demo` / `demo123`; solve the captcha shown in chat.
4. Click **Reset** to restore the sandbox.

## Environment
| Variable | Default |
|---|---|
| `GROQ_API_KEY` | required from source ([console.groq.com/keys](https://console.groq.com/keys)) |
| `GOOGLE_API_KEY` | optional, enables Gemini fallback |
| `MODEL` | `openai/gpt-oss-120b` |
| `FALLBACK_MODEL` | `gemini-3.5-flash` |
| `MAX_STEPS` | `30` |

## Scripts
`dev`, `seed`, `eval`, `build`, `test`, `typecheck`, `lint`