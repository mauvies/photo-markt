-- T-227: stop `anon` reading every column of a photographer's profile, and take
-- TRUNCATE away from the API roles.
--
-- ## The exposure
--
-- `profiles` carries the policy `photographer_profiles_public_select`:
--
--     using (active_role = 'PHOTOGRAPHER')
--
-- RLS is ROW-level, not column-level, so a policy that admits the row admits
-- every column of it. Combined with the Supabase default `grant all` for `anon`,
-- an unauthenticated request returned the photographer's legal name, full postal
-- address, Stripe customer/Connect ids and the payout-details jsonb:
--
--     GET /rest/v1/profiles?select=full_name,address_line1,postal_code,
--                                  stripe_connect_account_id,payout_details_json
--     → [{"full_name":"…","address_line1":"…","stripe_connect_account_id":"acct_…"}]
--
-- `active_role` DEFAULTS to 'PHOTOGRAPHER', so this reached almost every row.
--
-- ## The fix, and why it is a column grant
--
-- RLS cannot express "this row, but not those columns". The alternatives were a
-- public view or splitting the sensitive columns into a second table — both mean
-- touching application code. A column grant closes the hole with no code change
-- AND turns the grant list into an allow-list: a column added to `profiles` from
-- now on is NOT public until someone adds it here deliberately.
--
-- The granted set is derived from the code, not from taste:
--   * `getPhotographerBySlug` (src/database/queries/photographers.ts) selects
--     id, username, slug, display_name, bio, avatar_url, city, country_code,
--     created_at — the public photographer profile page.
--   * `searchPhotographers` filters on `active_role`, and Postgres requires
--     SELECT on a column to filter by it.
-- Everything else — full_name, address_line*, postal_code, state_or_region,
-- stripe_*, payout_*, default_* — is withheld.
--
-- ⚠️ `authenticated` is deliberately NOT restricted here. A column grant is
-- per-role and cannot tell "my row" from "someone else's", so restricting it
-- would break a photographer reading their own address in settings. That half of
-- the exposure (any signed-in user can read any photographer's address) needs the
-- columns moved out of `profiles`; it is pinned by a test and split into its own
-- ticket.
--
-- ⚠️ `supabase/seed.sql` re-applies this. Its blanket
-- `grant select … on all tables in schema public` runs AFTER migrations on
-- `db reset`, and would silently restore table-wide SELECT locally — leaving the
-- RLS tests asserting a posture production does not have.

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

-- ## TRUNCATE
--
-- TRUNCATE is NOT subject to row-level security, so on a table whose only
-- protection is RLS it is the one privilege that bypasses the entire model. The
-- API roles hold it on all 26 public tables purely as the Supabase bootstrap
-- default — no migration here ever asked for it.
--
-- Not exploitable today: PostgREST exposes no TRUNCATE verb and no persisted
-- function in `public` builds dynamic SQL. This is defence in depth, so that the
-- day one of those two facts changes it is not also a data-loss bug.
--
-- Safe against `db reset`: seed.sql re-grants only SELECT/INSERT/UPDATE/DELETE,
-- and the test harness's `resetDatabase` deletes rather than truncates.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- And for tables created later, so a future migration cannot silently re-arm it.
--
-- ⚠️ SCOPE: `alter default privileges` without `for role` targets only the
-- EXECUTING role's defaults — here `postgres`, which is the role migrations run
-- as and therefore the one that creates every table this repo owns. The platform
-- also carries a `supabase_admin`-grantor default ACL that still grants TRUNCATE,
-- and it cannot be changed from here (`postgres` gets "permission denied to
-- change default privileges" — verified, not assumed). Objects created BY
-- supabase_admin would re-arm it; the inventory test in
-- `test/integration/security/rls-table-inventory.test.ts` is the backstop, and it
-- reads the local stack, so this posture is asserted locally and not in prod.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- ⚠️ SELECT ONLY. `anon` and `authenticated` keep table-wide INSERT/UPDATE on
-- `profiles`, and `profiles_self_update` restricts rows (`id = auth.uid()`) but
-- not columns — so a signed-in photographer can still PATCH their own
-- `stripe_connect_account_id`, `stripe_connect_status` or `payout_details_json`
-- straight through PostgREST, bypassing the app.
--
-- Not closed here because the app writes those columns with the USER's client
-- (`settings/payout-profile/actions.ts` → `updateProfileStripeConnect`), so a
-- column-level UPDATE grant needs those call sites moved to `supabaseAdmin`
-- first. Bounded meanwhile: every money path re-derives the status from Stripe
-- through `reconcileAndPersistConnectStatus` before transferring, and redirecting
-- one's OWN payout account is self-harm rather than theft. Pinned as a known gap
-- in `profiles-rls.test.ts` and tracked in T-268 alongside the read half.
