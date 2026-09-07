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

-- ---------------------------------------------------------------------------
-- T-227 / T-268: re-apply the `profiles` posture that the blanket grant above
-- just undid.
--
-- The grants above are deliberately wholesale, and they run AFTER the migrations
-- on `supabase db reset`. So everything `20260907000000` does to `profiles` is
-- silently reversed locally unless it is repeated here.
--
-- That is not cosmetic: without this block, local would let `anon` read the
-- table `profiles` has become self-only about, and let any signed-in user
-- rewrite their own Stripe payout destination — while production does neither,
-- and the RLS tests would be asserting a posture no deployed environment has.
--
-- Keep these lists byte-identical to the migration's. The inventory test
-- (`test/integration/security/rls-table-inventory.test.ts`) reads them back out
-- of the catalog and compares them against one declared constant, so a drift
-- between the two files fails the suite rather than diverging quietly.
-- ---------------------------------------------------------------------------

-- Reads: anon has no business on the table at all — it reads `public_profiles`.
revoke select, insert, update, delete on public.profiles from anon;
grant select on public.public_profiles to anon, authenticated;

-- Writes: `authenticated` may edit its own profile, never the system's fields.
-- `stripe_connect_account_id` / `stripe_connect_status` are withheld.
revoke insert, update on public.profiles from authenticated;

grant insert (
  id, username, slug, display_name, bio, avatar_url, active_role,
  full_name, country_code, city, address_line1, address_line2,
  state_or_region, postal_code, is_payout_profile_complete, updated_at
) on public.profiles to authenticated;

grant update (
  username, slug, display_name, bio, avatar_url, active_role,
  full_name, country_code, city, address_line1, address_line2,
  state_or_region, postal_code, is_payout_profile_complete, updated_at
) on public.profiles to authenticated;
