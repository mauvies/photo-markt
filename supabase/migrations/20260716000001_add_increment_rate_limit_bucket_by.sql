-- Increment-by-N sibling of increment_rate_limit_bucket, on the same
-- rate_limit_buckets table (20260514000000). The face-search cost tiers
-- (T-034) must count REAL AWS calls per operation, not a flat +1, so they
-- increment by AWS_CALLS_PER_FACE_SEARCH. The existing increment-by-1 RPC is
-- left untouched — its other call sites (load-more, bib-search, download,
-- guest-upload, checkout) keep counting one request per call.
--
-- Same guarantees as the by-1 RPC: single-statement upsert with RETURNING
-- (atomic, no read-then-write race under concurrent serverless invocations),
-- SECURITY DEFINER, execute restricted to service_role so anon/authenticated
-- cannot inflate a bucket via direct PostgREST calls.

create or replace function public.increment_rate_limit_bucket_by(
  p_bucket_key text,
  p_window_start timestamptz,
  p_amount integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limit_buckets (bucket_key, window_start, count)
  values (p_bucket_key, p_window_start, p_amount)
  on conflict (bucket_key, window_start) do update
    set count = public.rate_limit_buckets.count + p_amount
  returning count into v_count;
  return v_count;
end;
$$;

-- Lock down execute. SECURITY DEFINER would otherwise let anyone with PostgREST
-- access call the function and tamper with the counter. Supabase grants EXECUTE
-- on public-schema functions to anon/authenticated during bootstrap, and those
-- explicit grants override a PUBLIC revoke — so revoke from the named roles too
-- (mirrors 20260514000001 for the by-1 RPC).
revoke all on function public.increment_rate_limit_bucket_by(text, timestamptz, integer) from public;
grant execute on function public.increment_rate_limit_bucket_by(text, timestamptz, integer)
  to service_role, postgres;
revoke execute on function public.increment_rate_limit_bucket_by(text, timestamptz, integer)
  from anon, authenticated;

comment on function public.increment_rate_limit_bucket_by(text, timestamptz, integer) is
  'Atomic increment of (bucket_key, window_start) by N → returns new count. Service-role only.';
