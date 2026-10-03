# Product

An Electron desktop app: the user types a task and watches an AI worker complete it inside Arcus, a fictional company.

## Layout
- **Left, Sandbox:** Files, Mail, Finance, Arcus Vendor Portal. Editable when idle, read-only during a run.
- **Center, Workspace:** live view of what the worker is touching: a file, an email, a Finance row (changes highlighted) or the live portal page.
- **Right, Activity:** every step: tool, result, retries, approvals, verification.
- **Bottom, Chat:** tasks, clarifying questions, approval cards, and secure inputs for credentials and captcha.

## Example task
> "Get the latest unpaid invoice from Acme Supplies on the vendor portal and add it to Finance."

The worker logs in to the portal (the user supplies the password and captcha), downloads the invoice, extracts amount and due date, requests approval, saves the record, recovers from an injected failure, verifies and summarizes.

## Success criteria
A user gives a task and sees autonomous steps, one recovery, one approval or question, independent verification, and a summary with evidence. Several task variations run on the same runtime.

## Non-goals
Real websites or credentials, general desktop automation, multi-agent, multi-user, accounts, cloud hosting, credential vault (see ROADMAP).