/**
 * DDL matching `schema.ts`. Kept by hand so the app needs no migration files at runtime;
 * `tests/db.test.ts` round-trips every table through Drizzle to catch drift.
 */
export const SANDBOX_DDL = `
CREATE TABLE IF NOT EXISTS vendors (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  email text NOT NULL,
  remit_account text NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_records (
  id serial PRIMARY KEY,
  vendor_id integer NOT NULL REFERENCES vendors(id),
  invoice_number text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  issue_date date,
  due_date date,
  status text NOT NULL,
  remit_account text,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_records_vendor_invoice UNIQUE (vendor_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS mail (
  id serial PRIMARY KEY,
  from_name text NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  received_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_attachments (
  id serial PRIMARY KEY,
  mail_id integer NOT NULL REFERENCES mail(id),
  filename text NOT NULL,
  content bytea NOT NULL
);

CREATE TABLE IF NOT EXISTS sandbox_meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.users (
  id serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS portal.invoices (
  id serial PRIMARY KEY,
  vendor_name text NOT NULL,
  invoice_number text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL,
  issue_date date NOT NULL,
  due_date date,
  status text NOT NULL,
  description text NOT NULL,
  pdf bytea NOT NULL
);
`

export const RUNS_DDL = `
CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  goal text NOT NULL,
  scenario text NOT NULL,
  status text NOT NULL,
  messages jsonb NOT NULL,
  facts jsonb NOT NULL,
  pending jsonb,
  step_count integer NOT NULL DEFAULT 0,
  writes jsonb NOT NULL,
  finish_attempts integer NOT NULL DEFAULT 0,
  used_fallback boolean NOT NULL DEFAULT false,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  summary text,
  verification jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_events (
  id serial PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs(id),
  seq integer NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_events_run ON run_events (run_id, seq);

-- Additive migrations: run history survives app upgrades.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS worklist jsonb NOT NULL DEFAULT '[]';
`

/** Sandbox tables are dropped on reset; run history survives. */
export const DROP_SANDBOX = `
DROP SCHEMA IF EXISTS portal CASCADE;
DROP TABLE IF EXISTS mail_attachments, mail, finance_records, vendors, sandbox_meta CASCADE;
`
