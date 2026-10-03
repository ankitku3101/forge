# Roadmap

Next steps, roughly in priority order.

1. **Credential vault:** store portal logins once; the agent refers to them by name and the harness fills them after user approval. Enables unattended runs.
2. **API proxy:** move the bundled LLM key to a small serverless proxy with rate limits, so no key ships inside the app.
3. **Signed installers:** remove macOS and Windows security warnings.
4. **More apps:** CRM, ticketing, and a second vendor portal with a different layout to test UI generalization.
5. **Smarter outcome verification:** for documents without ground truth, independent re-extraction compared against the agent's values.
6. **Replay viewer:** step through saved runs without calling the LLM.
7. **Learning from runs:** reusable notes about the environment (e.g., "portal sessions expire after 5 minutes").
8. **Web version:** the runtime is UI-independent, so it can move behind a hosted web UI later.