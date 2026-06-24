# local-database-grants Specification

## Purpose

Ensure the local Supabase development/test stack grants the API roles (`anon`, `authenticated`, `service_role`) the table-level DML privileges they need on `public` tables, so integration tests and local development behave like the hosted project. Grants are applied through a local-only bootstrap, are idempotent, preserve RLS posture, and surface a clear failure when missing.

## Requirements

### Requirement: Local stack grants DML to API roles on public tables

The local Supabase development/test stack SHALL grant `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on every table in schema `public` to the `anon`, `authenticated`, and `service_role` roles. The grant SHALL be applied through a local-only bootstrap that runs as the `postgres` superuser during `supabase db reset`, and SHALL NOT be applied to the hosted production project.

#### Scenario: service_role reads and writes public tables

- **WHEN** the test harness issues a supabase-js call with the local `service_role` key against any `public` table (e.g. `resetDatabase` deletes from `download_tokens`)
- **THEN** the request succeeds instead of returning `42501 permission denied for table …`

#### Scenario: anon and authenticated roles can be evaluated by RLS

- **WHEN** an anon- or authenticated-scoped client selects from an RLS-protected `public` table
- **THEN** the table-level grant permits the query to run and RLS decides which rows (if any) are returned — a missing grant never short-circuits before RLS

### Requirement: Future migration tables inherit the grants

The bootstrap SHALL include an `ALTER DEFAULT PRIVILEGES IN SCHEMA public` statement so that tables created by subsequent migrations automatically receive the same DML grants for the API roles, without a manual re-grant per table.

#### Scenario: a newly migrated table is immediately usable locally

- **WHEN** a new migration adds a `public` table and the developer runs `pnpm db:reset`
- **THEN** the API roles hold `SELECT/INSERT/UPDATE/DELETE` on that table without any additional grant step

### Requirement: Grants are idempotent and RLS-preserving

The bootstrap SHALL be safe to run repeatedly (re-running `supabase db reset` must not error) and SHALL NOT alter the row-level security posture of any table. Tables with the no-policy lockdown pattern (`admin_users`, `rate_limit_buckets`) SHALL remain inaccessible to `anon`/`authenticated` because RLS denies all rows when no policy grants them.

#### Scenario: repeated reset does not error

- **WHEN** `supabase db reset` runs the bootstrap more than once
- **THEN** the grant statements complete without raising an error

#### Scenario: locked-down tables stay locked down

- **WHEN** an anon- or authenticated-scoped client queries `admin_users` or `rate_limit_buckets` after the grants are applied
- **THEN** zero rows are returned because RLS has no permissive policy for those roles

### Requirement: Grant regression surfaces clearly

The test environment SHALL fail fast with an actionable message when the local API roles lack DML on `public` tables, rather than reporting the failure as ~135 opaque per-test `permission denied` errors.

#### Scenario: unprovisioned local DB reports the real cause

- **WHEN** the integration suite starts against a local stack whose API roles are missing DML grants
- **THEN** the harness reports a single clear failure pointing to "local DB not provisioned — run `pnpm db:reset`" instead of letting each test fail independently in `beforeEach`
