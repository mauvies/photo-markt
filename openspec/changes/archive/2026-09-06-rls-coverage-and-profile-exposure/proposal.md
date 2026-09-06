# T-227 · RLS test coverage, and the `profiles` exposure it uncovered

## Why

`test/integration/security/` covers 7 tables. `public` holds **26** (not the ticket's 30 — T-219 already
dropped `payment_accounts`, `ai_search_profiles`, `time_sync_tokens`, `upload_batches`,
`upload_objects`). All 26 have RLS enabled and `GRANT ALL` for `anon` and `authenticated`, so **RLS is
the only barrier** and 73 % of those barriers have never been exercised against an `anon` or a foreign
`authenticated` client. PR #279 is the precedent: a security control with no test is a control nobody
looks at again.

Measuring that surface found the hole the ticket anticipated ("salvo que aparezca un agujero"), and it
is **verified over HTTP against the local stack**, not inferred:

```
GET /rest/v1/profiles?select=full_name,address_line1,postal_code,stripe_connect_account_id,payout_details_json
  (anon apikey only, no session)
→ [{"full_name":"Real Name","address_line1":"221B Baker St","postal_code":"28001",
    "stripe_connect_account_id":"acct_SECRET","payout_details_json":{"iban":"ES91"}}]
```

`photographer_profiles_public_select` is `USING (active_role = 'PHOTOGRAPHER')`, and **RLS is
row-level, not column-level**, so it exposes the whole row: legal name, full postal address, Stripe
ids and the payout-details jsonb. `active_role` **defaults to `PHOTOGRAPHER`**, so this reaches
essentially every profile. The policy ships in a migration, so production has it.

## What Changes

- **Shared catalog helper** `test/helpers/db-catalog.ts`: extract `resolveDbContainer` / `queryJson` /
  `execSql` out of `security-definer-rpcs.test.ts` (today file-local) and re-point that test at it, with
  no behaviour change. supabase-js cannot run arbitrary SQL and `psql` is not on the host PATH, so
  catalog reads go through `docker exec … psql -tAc` with a `json_agg` wrapper.
- **Table inventory test** `test/integration/security/rls-table-inventory.test.ts`, modelled on the
  `SECURITY DEFINER` inventory: every `public` table must be declared in an allow-list as
  `policies-tested` or `total-denial` with a reason; an undeclared table fails the suite. Plus three
  allow-list-free properties: every table has RLS enabled, no policy is `USING (true)`, and neither
  `anon` nor `authenticated` holds TRUNCATE anywhere.
- **Behavioural RLS tests for the 19 untested tables**, grouped by domain so fixtures are shared, using
  the existing assertion idioms verbatim (`payouts-rls.test.ts` is the reference).
- **BREAKING (deliberate, and the point):** `anon` loses table-wide SELECT on `profiles` and gets an
  explicit **column** grant instead. The internet-facing half of the exposure closes; the
  `authenticated` half is pinned by a test as a known gap and split into its own ticket, because a
  column grant cannot distinguish "my row" from "someone else's" and closing it needs a schema change.
- **`supabase/seed.sql` is updated in the same PR** — its blanket `grant select … on all tables` runs
  after the migrations and would silently restore the exposure locally, leaving the new tests asserting
  a posture production does not have.
- **TRUNCATE / REFERENCES / TRIGGER revoked** from `anon` and `authenticated` on every public table,
  plus the matching `alter default privileges` so a future table cannot re-arm it. TRUNCATE is not
  subject to RLS.

## Capabilities

### New Capabilities

- `row-level-security-coverage`: every table in `public` declares a tested RLS posture, and the
  declaration itself is enforced by the suite.

### Modified Capabilities

(none — no existing spec covers table-level RLS posture or the `profiles` read surface)

## Impact

- New: `test/helpers/db-catalog.ts`, `test/integration/security/rls-table-inventory.test.ts` and ~8
  domain RLS test files.
- Changed: `test/integration/security/security-definer-rpcs.test.ts` (imports the helper),
  `test/helpers/supabase-test-client.ts` (`resetDatabase` must also clear
  `photos_orphan_storage_pending_cleanup`, which does not cascade from `auth.users`).
- New migration: column grants on `profiles` for `anon`, plus the TRUNCATE revoke. Additive,
  idempotent, rollback-inert.
- `supabase/seed.sql`: re-applies the profiles posture after its blanket grant.
- Docs: CLAUDE.md security conventions + `backlog/DECISIONS.md` §10.
- `scripts/advisors-baseline.ts` unchanged — Supabase's linter has no table-privilege rule, which is
  exactly why none of this was caught by the advisors gate.
- No application code changes: no anon path does `select('*')` on `profiles` (the only one,
  `getProfile`, is dashboard-only) and no PostgREST embed pulls `profiles` from another table.
