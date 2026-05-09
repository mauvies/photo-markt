-- The previous migration revoked EXECUTE on increment_rate_limit_bucket from
-- PUBLIC, but Supabase grants EXECUTE on public-schema functions to the `anon`
-- and `authenticated` roles explicitly during project bootstrap. Those grants
-- override our PUBLIC revoke, so anon could call the RPC via PostgREST and
-- inflate any bucket key (e.g. brute-force `admin-payout:<victim-uuid>` 30 times
-- to lock the victim out of the admin endpoint until the next window).
--
-- Strip those explicit grants. service_role still has EXECUTE from the
-- previous migration's grant + Supabase's default supabase_auth_admin grants.

revoke execute on function public.increment_rate_limit_bucket(text, timestamptz)
  from anon, authenticated;
