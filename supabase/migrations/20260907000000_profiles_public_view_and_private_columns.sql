-- T-268: close the two `profiles` gaps T-227 deliberately left open, and drop the
-- dead columns instead of protecting them.
--
-- ## What was still open after T-227
--
-- T-227 restricted `anon` to a column allow-list. Two halves remained, each
-- pinned by a KNOWN GAP test:
--
--   1. READ — `photographer_profiles_public_select` is
--      `using (active_role = 'PHOTOGRAPHER')`, and RLS is ROW-level, so ANY
--      signed-in account (a Google sign-up takes seconds) could read any
--      photographer's legal name, postal address and Stripe ids.
--   2. WRITE — the allow-list was SELECT only. `profiles_self_update` restricts
--      the row but not the columns, so a photographer could PATCH their own
--      `stripe_connect_account_id` — the transfer destination — bypassing the app.
--
-- ## 1. Dead columns: dropped, not protected
--
-- Six columns with no reader, no writer and no interface; four are not even in
-- the TypeScript types. `payout_method` / `payout_details_json` hold bank details
-- per their own migration comment (20250218000002) and are the DB half of the
-- pre-Connect payout design whose table, `payment_accounts`, T-219 already
-- dropped — their dictionary UI has sat orphaned ever since. Data that does not
-- exist cannot leak.
--
-- ⚠️ `profiles.stripe_customer_id` is NOT the live one: the customer ids the app
-- reads live on `subscriptions`, `orders` and `guest_orders`. This column was
-- never written by any code path.

alter table public.profiles
  drop column if exists payout_method,
  drop column if exists payout_details_json,
  drop column if exists stripe_customer_id,
  drop column if exists default_city,
  drop column if exists default_country,
  drop column if exists default_province;

-- ## 2. Read: `profiles` becomes self-only, with a public projection beside it
--
-- Dropping the public policy is what actually closes the leak — afterwards NO
-- policy admits another user's row, for any role, and the fix is structural
-- rather than a column list that has to be kept correct forever.
--
-- ⚠️ The view is created WITHOUT `security_invoker`, deliberately. An invoker
-- view would be evaluated as the caller and would therefore return nothing now
-- that the base table is self-only. Owner rights are what let it project rows the
-- base RLS hides — which is exactly why **its select list is the security
-- boundary**: a column added here is public the moment it is added, with no
-- policy left to catch it.
--
-- The `active_role = 'PHOTOGRAPHER'` filter reproduces the dropped policy
-- exactly, so this widens nothing: talent profiles were not public before and are
-- not public now.

drop policy if exists photographer_profiles_public_select on public.profiles;

drop view if exists public.public_profiles;

create view public.public_profiles as
  select
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
  from public.profiles
  where active_role = 'PHOTOGRAPHER';

comment on view public.public_profiles is
  'T-268: the ONLY public projection of profiles. Owner rights (no security_invoker) on purpose — profiles itself is self-only. Its column list is the allow-list: adding a column here makes it world-readable.';

grant select on public.public_profiles to anon, authenticated;

-- `anon` now reads the view and has no business touching the table at all. This
-- also retires T-227's column grants: one fewer list to keep in step with
-- seed.sql. (Its DML was already unreachable — every remaining policy requires
-- `auth.uid()`, which anon does not have.)
revoke select, insert, update, delete on public.profiles from anon;

-- ## 3. Write: the user may edit their own profile, not the system's fields
--
-- `profiles_self_update` restricts the ROW. The columns need their own
-- allow-list, because the same table legitimately takes user writes (display
-- name, bio, postal address) next to fields only Stripe's answer may set.
--
-- Withheld: `stripe_connect_account_id`, `stripe_connect_status`. The four call
-- sites that wrote them with the user's client move to `supabaseAdmin` in the
-- same change — three of them wrote inside a `.catch()` that only logs, so
-- without that move they would have failed silently.

revoke insert, update on public.profiles from authenticated;

grant insert (
  id,
  username,
  slug,
  display_name,
  bio,
  avatar_url,
  active_role,
  full_name,
  country_code,
  city,
  address_line1,
  address_line2,
  state_or_region,
  postal_code,
  is_payout_profile_complete,
  updated_at
) on public.profiles to authenticated;

grant update (
  username,
  slug,
  display_name,
  bio,
  avatar_url,
  active_role,
  full_name,
  country_code,
  city,
  address_line1,
  address_line2,
  state_or_region,
  postal_code,
  is_payout_profile_complete,
  updated_at
) on public.profiles to authenticated;

-- ⚠️ `supabase/seed.sql` re-applies all of the above. Its blanket
-- `grant select, insert, update, delete on all tables in schema public` runs
-- AFTER migrations on `db reset`, so without repeating this posture there the fix
-- would not exist locally and the RLS tests would assert something no deployed
-- environment has.
