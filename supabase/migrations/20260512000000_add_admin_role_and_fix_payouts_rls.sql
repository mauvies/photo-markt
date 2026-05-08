-- Security fix: introduce an admin role and lock down payouts RLS.
--
-- Before this migration:
--   * profiles had no admin marker
--   * payouts UPDATE policy was `using (true) with check (true)`, so any
--     authenticated user could PATCH any payout via PostgREST.
--
-- After:
--   * profiles.is_admin gates the /api/admin/payouts endpoint.
--   * The only RLS-permitted UPDATE is a photographer cancelling their own
--     pending payout. Approve/paid transitions go through the service role
--     client (which bypasses RLS).

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'Marks platform admins. Seed manually after deploy. Used by /api/admin/* endpoints.';

drop policy if exists "System can update payouts" on public.payouts;

drop policy if exists "Photographers can cancel their own pending payouts" on public.payouts;
create policy "Photographers can cancel their own pending payouts"
  on public.payouts
  for update
  using (auth.uid() = photographer_id and status = 'pending')
  with check (auth.uid() = photographer_id and status in ('pending', 'cancelled'));

-- Orders and order_items are inserted/updated exclusively by the Stripe webhook
-- using the service-role client, which bypasses RLS. The previous policies
-- granted authenticated users INSERT (for orders, with `with check (auth.uid()
-- = user_id)`) and INSERT/UPDATE (for order_items, with `using/with check
-- (true)`), enabling fake-purchase data to be written directly to PostgREST.
-- Drop them. Service role still works.
drop policy if exists "Users can create their own orders" on public.orders;
drop policy if exists "System can update orders" on public.orders;
drop policy if exists "System can insert order items" on public.order_items;

-- avatar_url is rendered into <img src> across the app and OG tags. PostgREST
-- PATCH on profiles bypasses our server actions; constrain the column to https
-- URLs at the DB so a `data:` or `javascript:` URI cannot be persisted.
alter table public.profiles drop constraint if exists profiles_avatar_url_https;
alter table public.profiles
  add constraint profiles_avatar_url_https
  check (avatar_url is null or avatar_url ~ '^https://') not valid;
-- Existing rows are seeded from Google OAuth (lh3.googleusercontent.com) and
-- are already https, but `not valid` skips the historical-row check to keep
-- this migration safe even if a stray row predates the constraint.
