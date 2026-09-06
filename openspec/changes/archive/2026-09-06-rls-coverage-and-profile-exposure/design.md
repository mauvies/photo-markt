# Design — rls-coverage-and-profile-exposure (T-227)

Transcription of the plan approved in-session (2026-09-06). Motivation in `proposal.md`.

## Context

26 tables in `public`, all with `relrowsecurity = true`, none with `USING (true)`, 7 with zero
policies (total denial by design). 50 policies total. Every table grants all seven privileges to
`anon`, `authenticated` and `service_role` — the Supabase bootstrap default ACL, not anything this
repo wrote; the only table-level GRANTs in the 93 migrations are for three tables T-219 dropped.

Existing test vocabulary, to be reused rather than reinvented (`test/helpers/supabase-test-client.ts`):
`createServiceClient()`, `createAnonClient()`, `signInAs(email)`, `createTestUser(role)`,
`createTestEvent(userId)`, `createTestPhoto(eventId)`, `resetDatabase()`.

## Goals / Non-Goals

**Goals:**
- Every `public` table has a declared, tested RLS posture; a new undeclared table fails the suite.
- Close the anon-facing half of the `profiles` exposure, and keep local and production in agreement.
- Remove TRUNCATE from the API roles as defence in depth.

**Non-Goals:**
- Closing the `authenticated` half of the exposure (needs a schema change — own ticket).
- Trimming per-table DML grants (`seed.sql` re-grants them wholesale; high risk, low value).
- Pruning `user_roles` (exists, empty, dead) or de-duplicating the two identical `profiles` SELECT
  policies — both are declared/annotated, not touched.

## Decisions

1. **Catalog access via `docker exec … psql`, extracted to a helper.** `security-definer-rpcs.test.ts`
   already established this (supabase-js cannot execute arbitrary SQL; `psql` is not on the host PATH;
   the integration suite already requires Docker). Extracting it is preferable to a second copy, and
   the module-level container memoisation is safe under `pool: 'forks'` + `fileParallelism: false`.

2. **The inventory asserts "nothing undeclared", not "everything declared exists".** `expected` is
   built from the keys of `actual` with a sentinel for undeclared tables, so one `toEqual` names the
   offender. Local and production have drifted before (`sync_profile_avatar_url` lives in prod and in
   no migration), so the reverse assertion would be a false alarm generator.

3. **Column-level grants, not a view or a narrower policy.** RLS cannot restrict columns, so the
   options were a public view, moving columns to a second table, or column grants. Column grants are
   the only one that closes the hole without touching application code, and they turn the grant list
   into an allow-list: a new `profiles` column is no longer public by default.
   The granted set is derived from the code, not from taste — `getPhotographerBySlug`
   (`src/database/queries/photographers.ts:44`) selects `id, username, slug, display_name, bio,
   avatar_url, city, country_code, created_at`, and `searchPhotographers` filters on `active_role`
   (filtering on a column requires SELECT on it). Everything else — `full_name`, `address_line*`,
   `postal_code`, `state_or_region`, `stripe_*`, `payout_*`, `default_*` — is withheld.

4. **`seed.sql` must repeat the posture.** Its `grant select, insert, update, delete on all tables in
   schema public` runs after the migrations, so without an update the fix would not exist locally and
   the new tests would assert a posture production does not have. The revoke + column grant is
   re-applied there, kept idempotent.

5. **Revoking TRUNCATE is safe and survives `db:reset`.** `seed.sql` only re-grants SELECT/INSERT/
   UPDATE/DELETE, so the revoke is not undone; PostgREST exposes no TRUNCATE verb; `resetDatabase`
   uses `.delete()`. Revoking DML instead would be undone by the seed on every reset — that is the
   asymmetry that makes one half of this cheap and the other half a trap.

6. **`beforeAll(resetDatabase)` in denial-only blocks.** CLAUDE.md prescribes `beforeEach`, and the
   reason is that ordering must not be able to quietly pass or fail a test. Blocks that only read or
   only assert denied writes mutate nothing, so that reason does not apply; `fileParallelism: false`
   makes the saving real. The deviation is stated in each file that takes it.

## Risks / Trade-offs

- [An anon path doing `select('*')` on `profiles` would start failing with 42501] → verified none
  exists today (`getProfile` is dashboard-only, no PostgREST embeds pull `profiles`); a positive-control
  test runs `getPhotographerBySlug`'s exact column list as anon so a future regression is caught.
- [Local and production diverge if `seed.sql` is forgotten] → the seed edit ships in this PR and
  `pnpm db:reset` is a verification step, not an afterthought.
- [The `authenticated` half stays open] → deliberate and pinned by a test that declares it a known gap,
  so the next reader finds a documented decision rather than an oversight.
- [The migration might not reach production] → `migrate.yml` has silently failed before (Actions
  minutes); `pnpm ops:drift` exists for exactly this and is named in the verification steps.

## Migration Plan

One additive, idempotent migration (column grants + TRUNCATE revoke). Rollback is inert: reverting the
code needs no down-migration, and restoring the old posture would be a new migration — which is the
right friction for re-opening a data exposure.

## Open Questions

None — both scope decisions (fix anon now / split `authenticated`; revoke TRUNCATE) were settled with
the user before planning.
