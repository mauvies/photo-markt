## 1. Restore local DML grants

- [x] 1.1 Add an idempotent grant block to `supabase/seed.sql`: `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;` (re-runnable without error).
- [x] 1.2 Add `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;` so future migration tables inherit the grants.
- [x] 1.3 Add a comment in `seed.sql` explaining this is a local-only fix for the CLI-bump grant regression and that it must stay idempotent.

## 2. Apply and verify the fix locally

- [x] 2.1 Run `pnpm db:reset` to re-run migrations + seed and apply the grants to the existing local volume.
- [x] 2.2 Confirm via the DB that `service_role`, `anon`, `authenticated` now hold `SELECT/INSERT/UPDATE/DELETE` on representative tables (`profiles`, `download_tokens`, `events`, `photos`).
- [x] 2.3 Run `pnpm test:integration` and confirm all integration suites pass (previously ~135 failing in `beforeEach`).
- [x] 2.4 Run `pnpm test:unit` to confirm unit tests are unaffected.

## 3. Preserve RLS posture (regression assertion)

- [x] 3.1 Verify the existing `test/integration/security/**` RLS tests still pass — table grants must not weaken row-level access.
- [x] 3.2 Confirm (test or manual probe) that anon/authenticated still read zero rows from `admin_users` and `rate_limit_buckets` after the grants are applied.

## 4. Harden against recurrence

- [x] 4.1 Add a fast pre-flight to the integration test setup: a single service-role probe that, on `42501 permission denied`, throws one actionable error ("Local Supabase not provisioned for tests — run `pnpm db:reset`") instead of letting every test fail in `beforeEach`.
- [x] 4.2 Decide and apply CLI alignment: pin the `supabase` devDependency in `package.json` (exact vs. caret per the design's open question) so contributors provision consistently.
- [x] 4.3 Confirm the pre-flight does not run (or is a no-op) for `pnpm test:unit`, keeping unit tests Docker-free.

## 5. Documentation

- [x] 5.1 Document the one-time `pnpm db:reset` requirement and the grant-regression cause in `test/README.md`.
- [x] 5.2 Add a brief note to `CLAUDE.md` (Testing section) so future contributors recognize the "permission denied for table" symptom and the fix.

## 6. Final checks

- [x] 6.1 Run `pnpm typecheck` and `pnpm lint` clean.
- [x] 6.2 Run the full `pnpm test` once with the local stack up and confirm green end-to-end.
