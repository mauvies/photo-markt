-- Local-reset compatibility shim, second of its kind.
--
-- The schema dump in `20260427162800_remote_schema.sql` (lines 291-297)
-- DROPs four tables that the app code actively uses:
--   * download_tokens
--   * guest_order_items
--   * guest_orders
--   * pending_guest_checkouts
--
-- No subsequent migration recreates them. On staging these tables exist
-- because the dump was generated from a state where they had been recreated
-- manually after the drops; locally, a fresh `supabase db reset` leaves a DB
-- without them and the guest-checkout webhook handler crashes.
--
-- This migration re-applies the original create-table statements (idempotent
-- via `if not exists`). On staging the bodies are no-ops because the tables
-- already exist; locally they reappear and unblock integration tests for the
-- guest-checkout flow.

create table if not exists public.guest_orders (
  id uuid primary key default gen_random_uuid(),
  guest_email text not null,
  stripe_checkout_session_id text unique not null,
  stripe_payment_intent_id text unique,
  stripe_customer_id text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'canceled', 'refunded')),
  total_amount_cents int not null check (total_amount_cents >= 0),
  currency text not null default 'usd',
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.guest_order_items (
  id uuid primary key default gen_random_uuid(),
  guest_order_id uuid not null references public.guest_orders(id) on delete cascade,
  photo_id uuid not null references public.photos(id) on delete restrict,
  photographer_id uuid not null references auth.users(id) on delete restrict,
  unit_price_cents int not null check (unit_price_cents >= 0),
  quantity int not null default 1,
  total_price_cents int not null check (total_price_cents >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pending_guest_checkouts (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text unique,
  cart_items jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default (timezone('utc', now()) + interval '2 hours')
);

create table if not exists public.download_tokens (
  id uuid primary key default gen_random_uuid(),
  token text unique not null default encode(gen_random_bytes(32), 'hex'),
  guest_order_id uuid references public.guest_orders(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '30 days'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint exactly_one_order check (
    (guest_order_id is not null)::int + (order_id is not null)::int = 1
  )
);

create index if not exists guest_orders_guest_email_idx on public.guest_orders(guest_email);
create index if not exists guest_orders_session_idx on public.guest_orders(stripe_checkout_session_id);
create index if not exists guest_order_items_order_idx on public.guest_order_items(guest_order_id);
create index if not exists guest_order_items_photographer_idx on public.guest_order_items(photographer_id);
create index if not exists guest_order_items_photo_idx on public.guest_order_items(photo_id);
create index if not exists pending_guest_checkouts_session_idx
  on public.pending_guest_checkouts(stripe_session_id);
create index if not exists download_tokens_token_idx on public.download_tokens(token);
create index if not exists download_tokens_guest_order_idx on public.download_tokens(guest_order_id);
create index if not exists download_tokens_order_idx on public.download_tokens(order_id);
create index if not exists download_tokens_claimed_by_user_idx
  on public.download_tokens(claimed_by_user_id);

alter table public.guest_orders enable row level security;
alter table public.guest_order_items enable row level security;
alter table public.pending_guest_checkouts enable row level security;
alter table public.download_tokens enable row level security;
-- Service-role-only access (the webhook + the /download/[token] route both
-- use supabaseAdmin). No public policies.

drop policy if exists "Users can view their claimed tokens" on public.download_tokens;
create policy "Users can view their claimed tokens"
  on public.download_tokens for select
  using (claimed_by_user_id = auth.uid());
