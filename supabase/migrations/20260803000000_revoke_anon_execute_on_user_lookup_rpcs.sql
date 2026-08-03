-- Security fix: revoke anonymous EXECUTE on the SECURITY DEFINER RPCs that read
-- `auth.users`.
--
-- THE VULNERABILITY (found 2026-08-03, live in production):
--   `search_users_by_text`, `search_user_by_email` and `get_user_emails_batch`
--   are SECURITY DEFINER functions that select email out of `auth.users`. All
--   three were executable by the `anon` role, i.e. by anyone holding the
--   PUBLISHABLE anon key — which ships in the browser bundle by design
--   (NEXT_PUBLIC_SUPABASE_ANON_KEY). A single unauthenticated request
--
--     POST /rest/v1/rpc/search_users_by_text {"search_text":"@","result_limit":1e6}
--
--   returned the email + display name of EVERY registered user, because:
--     * `search_text` is interpolated into a LIKE pattern unescaped, so "@" (or
--       "") matches every row;
--     * `result_limit` is caller-controlled with no server-side ceiling.
--   That is a GDPR-reportable personal-data exposure and a ready-made list for
--   credential stuffing and targeted phishing.
--
-- WHY IT HAPPENED — the trap is worth stating, because it is invisible in a diff:
--   Postgres grants EXECUTE on new functions to PUBLIC by default. The original
--   migrations (20250212000003, 20250212000004, 20250214000002) did
--
--     grant execute on function ... to authenticated;
--
--   which READS like a restriction but is purely additive: it never removed the
--   default PUBLIC grant, and `anon` is a member of PUBLIC. The function was
--   world-executable from the day it was created.
--
--   CLAUDE.md already documents this exact rule ("new SECURITY DEFINER functions
--   must explicitly revoke execute from anon, authenticated"), and
--   20260514000001 applied it correctly to the rate-limit RPCs. But the rule was
--   written in May 2026 and these functions date from February 2025 — nobody
--   ever swept the ones that predated the convention. The convention was right;
--   its retroactive coverage was zero.
--
-- WHAT THIS MIGRATION DOES:
--   Revokes from PUBLIC + anon, then re-grants to the roles that legitimately
--   need it. All three functions ARE used by live authenticated code paths
--   (queries/profiles.ts, queries/sales.ts, events/[id]/actions.ts), so they
--   cannot simply be dropped.
--
--   `sync_profile_avatar_url` is a TRIGGER function; it was also PUBLIC-executable
--   for the same reason. Triggers do not check EXECUTE on the calling role, so
--   revoking from every API role is safe and removes a pointless RPC surface.
--
-- NOT COVERED HERE — deliberate:
--   `order_has_photographer_items` is also anon-executable, but it is referenced
--   from the `orders` RLS policy "Photographers can view orders for their photos".
--   A policy helper is evaluated with the QUERYING role's privileges, so revoking
--   EXECUTE turns an anon SELECT on `orders` from "empty result" into "permission
--   denied for function". Its leak is a boolean oracle that already requires two
--   unguessable UUIDs, so the risk of the fix currently exceeds the risk of the
--   bug. Tracked separately; fix it together with a test that exercises the anon
--   read path on `orders`.
--
-- Idempotent: revoke/grant are safe to re-run, so re-application by migrate.yml
-- after this was already applied by hand to prod + staging is a no-op.
--
-- Every statement is guarded on the function existing, because the environments
-- have drifted: `sync_profile_avatar_url` is live in prod and staging but is NOT
-- created by any migration in this repo (it arrived via a remote schema dump), so
-- an unguarded REVOKE fails `supabase db reset` locally with 42883. Same guard
-- style as 20260512000000's avatar_url constraint, and the same root cause the
-- project already knows about: the migration set is not a complete description of
-- production.

do $$
declare
  fn text;
begin
  -- ── Revoke the default PUBLIC grant (the actual bug) ──────────────────────
  foreach fn in array array[
    'public.search_users_by_text(text, int)',
    'public.search_user_by_email(text)',
    'public.get_user_emails_batch(uuid[])'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon', fn);
      execute format('grant execute on function %s to authenticated, service_role', fn);
    else
      raise notice 'skipping %, not present in this environment', fn;
    end if;
  end loop;

  -- Trigger function: no API role ever needs to call it directly.
  if to_regprocedure('public.sync_profile_avatar_url()') is not null then
    execute 'revoke execute on function public.sync_profile_avatar_url() from public, anon, authenticated';
  end if;
end $$;

comment on function public.search_users_by_text(text, int) is
  'Search users by username, email or display name (partial match). SECURITY DEFINER over auth.users — MUST NOT be executable by anon (see 20260803000000). Still readable by any authenticated user: narrowing that is a follow-up.';
comment on function public.get_user_emails_batch(uuid[]) is
  'Get emails for multiple users by id. SECURITY DEFINER over auth.users — MUST NOT be executable by anon (see 20260803000000).';
