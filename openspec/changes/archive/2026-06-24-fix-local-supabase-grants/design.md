## Context

After commit `c56c8d9` (`update Supabase CLI version`, bumping the `supabase` devDependency to `^2.107.0` and `supabase/.temp/cli-latest` to `v2.107.0`), the entire integration suite fails. The symptom looked like a broken `test:integration` script or stale local keys, but direct probing shows otherwise:

- `supabase status` exposes both legacy demo JWT keys and new-format keys (`sb_publishable_…` / `sb_secret_…`). The harness hardcodes the legacy JWTs in `test/setup.ts` and `test/helpers/supabase-test-client.ts`.
- GoTrue admin (`/auth/v1/admin/users`) accepts **both** the legacy service JWT and the new secret key → HTTP 200. So key authentication is **not** the problem.
- PostgREST (`/rest/v1/*`) returns `403 / 42501 permission denied for table …` for **both** keys. The failure is at the Postgres GRANT layer, not the auth layer.
- Inspecting the DB: all 30 `public` tables are owned by `postgres`. The API roles (`anon`, `authenticated`, `service_role`) hold only `TRUNCATE, REFERENCES, TRIGGER` on them — **no `SELECT/INSERT/UPDATE/DELETE`**. `pg_default_acl` shows the DML-granting default privileges (`arwdDxtm`) are scoped to `supabase_admin` ownership, while `postgres`'s own default privileges grant the API roles only `Dxtm`. Because the CLI now creates/owns these tables as `postgres`, the DML grants never land.
- The first thing the harness does in `beforeEach` is `resetDatabase`, whose first statement is a service-role `DELETE` on `download_tokens` → `permission denied` → every test throws before exercising any real logic (hence the uniform <25 ms failures).

A rolled-back transaction confirmed the fix: `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;` then `SET LOCAL ROLE service_role;` makes the previously-denied `SELECT`/`DELETE` succeed.

**Constraints:** the fix must not touch production schema/security; it must be reproducible for every contributor; it must keep RLS as the row-level gate (this is Supabase's documented default posture — grant-all on `public` + RLS).

## Goals / Non-Goals

**Goals:**
- Make `pnpm test:integration` (and `pnpm dev` against local Supabase) green again by restoring DML grants for the API roles on local `public` tables.
- Keep the fix local-only with zero production-schema impact.
- Make future migration tables inherit the grants automatically.
- Reduce time-to-diagnosis if this regresses: a single actionable failure, not 135 opaque ones.

**Non-Goals:**
- Changing application code, RLS policies, or the row-level security posture.
- Migrating the harness off the legacy demo JWT keys to the new `sb_*` key format (the legacy keys authenticate fine; the only problem was grants). Optional follow-up, not required here.
- Adding a production migration that re-asserts grants on the hosted project (prod already has them).
- Reworking the documented test commands.

## Decisions

### Decision 1: Where the grants live → `supabase/seed.sql` (local-only bootstrap)

`seed.sql` runs as the `postgres` superuser as the final step of `supabase db reset` (and on first start of a fresh DB). `postgres` owns the tables, so it can `GRANT`. It never runs against the hosted project, so production is untouched. Add:

```sql
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
```

- **Why not a migration?** A migration would also execute against production, changing prod's grant posture (or at best being a redundant no-op there) and triggering the CLAUDE.md "security-sensitive DB change" review gate. The breakage is purely local provisioning, so the fix belongs in the local-only bootstrap.
- **Why not fix it inside the test harness?** The harness connects via supabase-js as `service_role`, which is not a superuser and cannot `GRANT`. A harness-side fix would require a separate raw `postgres` superuser connection (new dependency) and would still leave `pnpm dev` broken locally. `seed.sql` fixes both tests and local dev in one place.
- **Why not pin/downgrade the CLI as the primary fix?** The running stack already exhibits the new behavior under multiple CLI versions, and pinning fights the ecosystem moving forward. CLI alignment is worthwhile as hardening (Decision 3), not as the load-bearing fix.

### Decision 2: Grant to all three API roles, not just `service_role`

The tests need `service_role` for setup/teardown, but the RLS regression tests (`test/integration/security/**`) use anon- and authenticated-scoped clients (`createAnonClient`, `signInAs`). Without a table-level grant, those queries fail with `permission denied` **before** RLS is ever evaluated, so RLS assertions become meaningless. Granting all three restores Supabase's standard posture where the table grant is open and RLS is the real gate. Locked-down tables (`admin_users`, `rate_limit_buckets`) stay safe: they enable RLS with no permissive policy, so anon/authenticated still get zero rows.

### Decision 3: Harden against recurrence

- Pin/align the `supabase` CLI dependency (currently devDep `^2.107.0` while the globally-installed binary is `2.98.2`) so every contributor's `supabase start` provisions identically.
- Add a fast pre-flight in the integration setup: one service-role probe (e.g. `select` against a known table) that, on `42501`, throws a single message — "Local Supabase not provisioned for tests — run `pnpm db:reset`" — instead of letting `resetDatabase` fail 135 times. This converts a confusing mass failure into a one-line diagnosis.
- Document the one-time `pnpm db:reset` in `test/README.md` / `CLAUDE.md`.

## Risks / Trade-offs

- **Existing local volumes won't pick up the grants until `db:reset`** → `seed.sql` only runs on reset/fresh start, not on `supabase start` against a persisted volume. Mitigation: tasks require running `pnpm db:reset` once and the pre-flight (Decision 3) tells anyone who skips it exactly what to do.
- **Blanket grant feels broad** → mirrors Supabase's documented default; RLS remains the row-level boundary and the no-policy lockdown tables are unaffected. Verified by an RLS regression assertion in the tasks.
- **`ALTER DEFAULT PRIVILEGES` is role-scoped to whoever runs it** → it must be executed by the table-owning role (`postgres`), which is exactly the role that runs `seed.sql`, so future `postgres`-owned tables inherit correctly. If a future migration creates tables under a different owner, the explicit `GRANT ON ALL TABLES` in `seed.sql` still backfills them on the next reset.
- **Pinning the CLI could drift from the hosted Supabase version** → low risk for local-only tooling; revisit when intentionally upgrading.

## Migration Plan

1. Add the idempotent grant + default-privileges block to `supabase/seed.sql`.
2. Add the pre-flight grant probe to the integration test setup.
3. Pin/align the `supabase` CLI dependency.
4. Apply locally: `pnpm db:reset` (re-runs migrations + seed), then `pnpm test:integration` → expect green.
5. Update `test/README.md` / `CLAUDE.md` with the `db:reset` note.

**Rollback:** revert the `seed.sql` and setup edits; the change is local-only, so there is nothing to roll back in production.

## Open Questions

- Pin the `supabase` CLI to an exact version vs. a caret range? (Leaning exact-pin for reproducibility; confirm with the team's upgrade cadence.)
- Should the pre-flight live in `test/setup.ts` (runs for unit tests too, so it must be a no-op when no DB is expected) or in a dedicated integration-only setup file? (Leaning integration-only to keep unit tests Docker-free.)
