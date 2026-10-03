# Sandbox

Arcus, a fictional company, seeded deterministically. Rebuild with `pnpm seed` or the in-app **Reset** button.

## Contents
- **Files:** a real folder in the app data directory: `Invoices/`, `Policies/` (approval policy, vendor list), `Notes/`.
- **Mail:** ~15 emails: invoice notices, a payment reminder, noise.
- **Finance:** vendors and ledger records, some pre-existing. Unique on vendor + invoice number.
- **Arcus Vendor Portal:** see `PORTAL.md`.

**Vendors:** Acme Supplies, Acme Supply Co., Brightline Logistics, Norvale Office.

## Seed
`seed/fixtures.json` (scenario data and ground truth) plus faker filler with a fixed seed. `seed/build.ts` writes DB rows, PDFs and files.

## Scenarios
Chosen in the app or by the eval runner.

| Scenario | Injected condition |
|---|---|
| `happy_path` | none |
| `transient_error` | first `create_record` fails |
| `duplicate` | invoice already in Finance |
| `ambiguous_vendor` | two Acme vendors match |
| `missing_info` | invoice has no due date |
| `session_expired` | portal logs out mid-task |
| `verification_mismatch` | Finance silently rounds the amount |

Faults live in `src/main/sandbox/faults.ts`, outside the agent runtime, and are documented as manual configuration.