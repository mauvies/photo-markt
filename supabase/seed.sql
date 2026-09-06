-- Local development seed data.
-- Runs automatically as the last step of `supabase db reset`.
--
-- Intentionally empty of fixtures. Integration tests create their own data
-- via `test/helpers/supabase-test-client.ts` (see createTestUser /
-- createTestEvent / createTestPhoto). Manual dev seed data, if added later,
-- should go below the grant block and be idempotent (use `ON CONFLICT DO
-- NOTHING` or wrap in `if not exists` blocks) so re-running doesn't double-insert.

-- ---------------------------------------------------------------------------
-- LOCAL-ONLY: restore standard Supabase DML grants for the API roles.
--
-- Why this exists: a Supabase CLI bump (commit c56c8d9) changed how the local
-- stack provisions migration-created tables. The `public` tables end up owned
-- by `postgres`, whose default privileges grant the API roles only
-- TRUNCATE/REFERENCES/TRIGGER — NOT SELECT/INSERT/UPDATE/DELETE. The result was
-- every supabase-js call (incl. the test harness's resetDatabase) failing with
-- `42501 permission denied for table …`, taking the whole integration suite —
-- and `pnpm dev` against local Supabase — down.
--
-- This restores Supabase's documented default posture: open table-level grants
-- on `public` + RLS as the row-level gate. Row access is UNCHANGED — RLS still
-- decides which rows each role sees (the no-policy lockdown on `admin_users`
-- and `rate_limit_buckets` still returns zero rows to anon/authenticated).
--
-- This file never runs against the hosted project, so production is untouched.
-- Runs as the `postgres` superuser (the table owner), so the GRANTs succeed.
-- MUST stay idempotent: re-running `supabase db reset` re-applies it cleanly.
-- ---------------------------------------------------------------------------

-- Backfill existing tables.
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

-- Make tables created by future migrations inherit the same grants without a
-- per-table re-grant. Scoped to objects created by `postgres` (the owner that
-- runs migrations + this seed), which is exactly where the gap was.
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- T-227: re-apply the `profiles` column restriction that the blanket grant above
-- just undid.
--
-- The grants above are deliberately wholesale, and they run AFTER the migrations
-- on `supabase db reset`. So `20260906000000_restrict_anon_profile_columns.sql`
-- — which revokes table-wide SELECT on `profiles` from `anon` and grants an
-- explicit column list instead — is silently reversed locally unless it is
-- repeated here.
--
-- That is not a cosmetic divergence: without this block, local would expose the
-- photographer's postal address, legal name and Stripe ids to `anon` while
-- production does not, and the RLS tests would be asserting a posture that no
-- deployed environment has. Keep this list byte-identical to the migration's.
--
-- TRUNCATE needs no such repetition: the grants above never include it.
-- ---------------------------------------------------------------------------

revoke select on public.profiles from anon;

grant select (
  id,
  username,
  slug,
  display_name,
  bio,
  avatar_url,
  city,
  country_code,
  created_at,
  active_role
) on public.profiles to anon;
