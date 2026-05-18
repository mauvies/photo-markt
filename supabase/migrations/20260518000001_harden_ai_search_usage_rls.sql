-- Audit finding (docs/AI_MATCHING_AUDIT.md §7): ai_search_usage had a
-- `using (true) with check (true)` policy for FOR ALL — any authenticated
-- user could insert/update/delete anyone's monthly counter via PostgREST.
-- Tighten to the same pattern as rate_limit_buckets: RLS on, owner-scoped
-- SELECT only, writes service-role only via the SECURITY DEFINER RPCs.

drop policy if exists "System can manage AI search usage" on public.ai_search_usage;

-- Owner-scoped SELECT is still useful (talent can see their own usage in the
-- dashboard). Already exists from the create migration — re-declare here so
-- this migration is idempotent on a fresh local reset.
drop policy if exists "Users can view their own AI search usage" on public.ai_search_usage;
create policy "Users can view their own AI search usage"
  on public.ai_search_usage
  for select
  using (auth.uid() = user_id);

-- The audit also flagged that the two SECURITY DEFINER RPCs have EXECUTE
-- granted to anon/authenticated by default (Supabase grants those roles
-- explicitly on bootstrap, so `revoke from public` doesn't cover them).
-- Without this revoke, anon could call the RPCs via PostgREST to brute-force
-- arbitrary user ids and inflate counters.
revoke execute on function public.increment_ai_search_usage(uuid)
  from anon, authenticated;
revoke execute on function public.get_ai_search_usage_count(uuid)
  from anon, authenticated;
-- service_role keeps EXECUTE via Supabase's default grants; the rate-limit
-- query layer calls the RPC using the admin client.

comment on table public.ai_search_usage is
  'Monthly AI-search counter. SELECT owner-scoped via RLS; writes service-role only via the SECURITY DEFINER RPCs.';
