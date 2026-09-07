-- T-218: bounded purge of expired rate_limit_buckets rows.
--
-- The limiter writes one row per (bucket_key, window_start) and nothing ever
-- read an old one again — the table grew with traffic × events and never
-- stopped. `cleanup-rate-limit-buckets` (Inngest, hourly at :20) calls this
-- with cutoff = now − 2 × MAX_RATE_LIMIT_WINDOW_SEC and a batch size, looping
-- until a batch comes back short.
--
-- Why an RPC and not `DELETE ... ?limit=N` through PostgREST: PostgREST 13
-- accepts `limit` on a DELETE and then deletes every matching row anyway
-- (verified locally — 5 seeded, limit=2 sent, 5 deleted, 5 returned). A batch
-- that is only a batch when the API layer feels like it is not a batch; the
-- LIMIT belongs in the statement. Oldest windows go first via the existing
-- `rate_limit_buckets_window_start_idx`.
--
-- Same posture as the two increment RPCs on this table: SECURITY DEFINER
-- (the table is RLS-enabled with no policies), EXECUTE revoked from anon and
-- authenticated explicitly — Supabase grants those at bootstrap and a PUBLIC
-- revoke does not override a role-specific grant (see 20260514000001).

create or replace function public.purge_rate_limit_buckets(
  p_cutoff timestamptz,
  p_limit integer
) returns integer
language sql
security definer
set search_path = public
as $$
  with victims as (
    select bucket_key, window_start
    from public.rate_limit_buckets
    where window_start < p_cutoff
    order by window_start asc
    limit greatest(p_limit, 0)
  ),
  deleted as (
    delete from public.rate_limit_buckets b
    using victims v
    where b.bucket_key = v.bucket_key
      and b.window_start = v.window_start
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.purge_rate_limit_buckets(timestamptz, integer) from public;
revoke execute on function public.purge_rate_limit_buckets(timestamptz, integer)
  from anon, authenticated;
grant execute on function public.purge_rate_limit_buckets(timestamptz, integer)
  to service_role, postgres;

comment on function public.purge_rate_limit_buckets(timestamptz, integer) is
  'Delete up to p_limit rate_limit_buckets rows with window_start < p_cutoff, oldest first → rows deleted. Service-role only (T-218).';
