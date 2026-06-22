-- Drop the orphaned per-plan monthly AI-search quota infrastructure.
--
-- The `ai_search_usage` table + its functions were built to meter face searches
-- per user per month, but were never wired into the app: face search is
-- anonymous-friendly (talent/guests with no account) and the advertised
-- "N searches/month" lives on photographer plans, so the searcher is not the
-- plan owner. That domain mismatch is being re-designed under ticket T-034;
-- this removes the half-built, misleading schema in the meantime. The live
-- anti-abuse limiter remains the per-(shareCode, IP) hourly cap in
-- src/lib/rate-limit.ts.
--
-- Safe: zero readers/writers in app code, seed, or tests. The trigger function
-- is used only by this table's trigger.

drop function if exists public.increment_ai_search_usage(uuid);
drop function if exists public.get_ai_search_usage_count(uuid);
drop table if exists public.ai_search_usage cascade;
drop function if exists public.set_ai_search_usage_updated_at() cascade;
