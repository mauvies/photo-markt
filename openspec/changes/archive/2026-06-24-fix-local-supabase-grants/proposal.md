## Why

Every integration test (~135 across 11 files) fails in <25 ms with `42501 permission denied for table …`, and local `pnpm dev` against the local Supabase stack is equally broken. The Supabase CLI bump in commit `c56c8d9` changed how the local stack provisions migration-created tables: the API roles (`anon`, `authenticated`, `service_role`) now hold only `TRUNCATE/REFERENCES/TRIGGER` on every `public.*` table and have lost `SELECT/INSERT/UPDATE/DELETE`. The test harness's `resetDatabase` (run in `beforeEach`) is the first thing to hit the wall, so the whole integration suite reports red even though no application code changed.

## What Changes

- Restore the standard Supabase grant posture on the **local** stack: `SELECT, INSERT, UPDATE, DELETE` on all `public` tables for `anon`, `authenticated`, `service_role`, plus an `ALTER DEFAULT PRIVILEGES` so future migration tables inherit them. Row access stays governed by RLS exactly as before — grants are table-level, RLS is row-level.
- Land the grants in a **local-only bootstrap** (`supabase/seed.sql`, which runs as the `postgres` superuser at the end of `supabase db reset`) so the fix is reproducible and carries zero production-schema impact.
- Document the one-time `pnpm db:reset` required to apply the fix to an already-provisioned local volume, and verify the full integration suite goes green afterward.
- Harden against recurrence: pin/align the `supabase` CLI dependency so contributors' local stacks provision consistently, and add a fast pre-flight check (or clear failure message) so a future grant regression surfaces as "local DB not provisioned" rather than 135 opaque red tests.
- No application code, no production migration, no change to the documented test commands.

## Capabilities

### New Capabilities
- `local-database-grants`: The local Supabase development/test stack must provision the standard DML grants for the API roles on all `public` tables so the integration harness and `pnpm dev` can read/write through supabase-js while RLS continues to enforce row-level access.

### Modified Capabilities
<!-- None — no existing spec's requirements change; application behavior and RLS posture are unchanged. -->

## Impact

- **Tests**: All integration suites under `test/integration/**` (queries, actions, api, security) currently fail in `beforeEach` → green after the fix. Unit tests (`test/unit`) are unaffected.
- **Local dev**: `pnpm dev` and any local script using `src/database/{server,client,supabase-admin}.ts` against local Supabase are unblocked.
- **Files**: `supabase/seed.sql` (add idempotent grants); `package.json` (`supabase` devDependency pin) and/or `supabase/config.toml`; possibly `test/setup.ts` or `test/helpers/supabase-test-client.ts` for the pre-flight guard; `CLAUDE.md` / `test/README.md` for the `db:reset` note.
- **Production**: None. The fix lives in `seed.sql`, which never runs against the hosted project; prod already carries the correct grants from its baseline.
- **Security posture**: Unchanged. The grants restore Supabase's documented default (grant-all + RLS); RLS policies (including the no-policy lockdown on `admin_users` / `rate_limit_buckets`) continue to deny rows to `anon`/`authenticated`.
