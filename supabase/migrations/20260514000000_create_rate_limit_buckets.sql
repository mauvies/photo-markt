-- Fixed-window rate limiter backed by a single counter table.
--
-- Each (bucket_key, window_start) row counts requests in that window.
-- `lib/rate-limit.ts` calls the SECURITY DEFINER RPC below to increment
-- atomically. The RPC is execute-restricted to service_role so anon and
-- authenticated cannot bypass the limiter via direct PostgREST calls.

create table if not exists public.rate_limit_buckets (
  bucket_key   text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (bucket_key, window_start)
);

alter table public.rate_limit_buckets enable row level security;
-- No policies: service-role-only access, mirroring admin_users.

-- Lets a future cleanup job prune old buckets without a full scan.
create index if not exists rate_limit_buckets_window_start_idx
  on public.rate_limit_buckets (window_start);

create or replace function public.increment_rate_limit_bucket(
  p_bucket_key text,
  p_window_start timestamptz
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limit_buckets (bucket_key, window_start, count)
  values (p_bucket_key, p_window_start, 1)
  on conflict (bucket_key, window_start) do update
    set count = public.rate_limit_buckets.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

-- Lock down execute. SECURITY DEFINER would otherwise let anyone with PostgREST
-- access call the function and tamper with the counter.
revoke all on function public.increment_rate_limit_bucket(text, timestamptz) from public;
grant execute on function public.increment_rate_limit_bucket(text, timestamptz)
  to service_role, postgres;

comment on table public.rate_limit_buckets is
  'Per-key fixed-window request counter. Service-role only.';
comment on function public.increment_rate_limit_bucket(text, timestamptz) is
  'Atomic increment of (bucket_key, window_start) → returns new count. Service-role only.';
