-- Security fix: bound `search_users_by_text` so an authenticated user cannot
-- dump the whole user table, and stop returning email at all.
--
-- WHAT #279 DID AND DID NOT FIX (2026-08-03):
--   20260803000000 revoked EXECUTE from `anon` on the SECURITY DEFINER RPCs that
--   read `auth.users`. That closed the ANONYMOUS leak — the bleeding — but left
--   the underlying defects untouched: any AUTHENTICATED user could still dump the
--   full roster. Signing up is Google OAuth, free and instant, so the real barrier
--   was about ten seconds. The RPC is also invocable DIRECTLY through PostgREST
--   with a user JWT, so the Server Action wrapping it (searchTalentUsers in
--   dashboard/photographer/events/[id]/actions.ts) protects nothing.
--
-- THE THREE DEFECTS, none of them about permissions:
--   1. `search_text` was interpolated into a LIKE pattern UNESCAPED. '@' matches
--      every email, '' matches everything, '%' matches everything. No minimum
--      length.
--   2. `result_limit` was caller-controlled with NO server-side ceiling.
--      result_limit = 1000000 returned a million rows. Measured against a local
--      DB seeded with 60 users: search_users_by_text('@', 1000000) => 61 rows.
--   3. It returned `email` — the actually sensitive column.
--
-- WHAT THIS MIGRATION DOES:
--   * Minimum search length of 3 characters after trim (below that: zero rows).
--     This alone kills '', '@' and '%'.
--   * Escapes %, _ and \ before building the LIKE pattern, and passes ESCAPE '\'
--     on every LIKE — including the ones in ORDER BY, which repeated the pattern
--     unescaped.
--   * Clamps the limit server-side: least(greatest(coalesce(result_limit,10),1),50).
--     The greatest() is not decorative — a negative LIMIT raises
--     "LIMIT must not be negative" in Postgres.
--   * DROPS `email` from the returned columns. This costs nothing: the only
--     consumer in the codebase already discards it (it maps to username +
--     display_name and no UI ever showed the email), and `search_user_by_email`
--     has zero callers.
--   * Matches email by EXACT equality only. Substring matching on username and
--     display_name is unchanged.
--
-- ⚠️ WHY EXACT, WHICH IS NOT OBVIOUS AND WAS GOT WRONG ONCE:
--   Dropping the output column alone does NOT close the leak, and believing it
--   does is the trap. The function returns a stable `u.id`, so a WHERE that
--   matches a substring of a secret and returns an identifier IS an oracle: for
--   any string of the caller's choosing they learn whether a given user's email
--   contains it. Photographer ids are routinely public (profile pages, slugs,
--   contributor lists), so an attacker anchors on the domain and walks left, one
--   probe per candidate character. Reproduced against a local DB (victim
--   'victim.secret1987@protonmail.com' hidden among 200 noise users, attacker
--   holding only the uuid):
--
--     search_users_by_text('proton', 50)           -> contains victim id
--     search_users_by_text('gmail', 50)            -> does not
--     search_users_by_text('7@protonmail.com', 50) -> contains victim id
--     search_users_by_text('5@protonmail.com', 50) -> does not
--
--   Neither the 3-char floor nor the limit interferes: every probe is naturally
--   >=3 characters and the answer is a membership test, not a row count. Gating
--   the email branch on "looks like an address" (normalized like '%@%.%') does
--   NOT help either — the probe above already satisfies it.
--
--   Exact match leaves only "is this complete address that user's?", which is
--   unavoidable for a lookup-by-email feature and no stronger than a login
--   enumeration oracle. Email is also gone from the ORDER BY: ranking rows by an
--   email prefix is the same channel, weaker but real (it would reveal the
--   prefix of a user found by username), and the tie-break falls back to username
--   only.
--
--   The cost is a UX one, accepted deliberately: typing half an email no longer
--   finds anyone. The tag-talent dialog still matches username and display_name
--   by substring as you type, so it degrades only for the type-an-email path.
--
-- WHY drop+create INSTEAD OF create-or-replace:
--   CREATE OR REPLACE cannot change the OUT columns of a RETURNS TABLE function.
--   `search_user_by_email` delegates with `select *`, so its signature has to be
--   dropped together with its delegate's, and it is recreated below.
--
-- ⚠️ THE TRAP THAT CAUSED THE ORIGINAL INCIDENT, AND WHY IT IS RE-STATED HERE:
--   DROP FUNCTION discards the grants. Postgres then grants EXECUTE on the NEW
--   function to PUBLIC by default, and `anon` is a member of PUBLIC — which is
--   exactly how these functions were world-executable from the day they were
--   created (a bare `grant execute ... to authenticated` READS like a restriction
--   but is purely additive). So this migration MUST re-apply the revoke from
--   20260803000000, or it silently re-opens the very hole that one closed. The
--   inventory test in test/integration/security/security-definer-rpcs.test.ts
--   fails if it does.
--
-- Idempotent: drop-if-exists + create + revoke/grant are all safe to re-run, so
-- re-application by migrate.yml after a manual apply via MCP is a no-op.

drop function if exists public.search_user_by_email(text);
drop function if exists public.search_users_by_text(text, int);

create function public.search_users_by_text(search_text text, result_limit int default 10)
returns table (
  id uuid,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Trimmed + lowercased once: every comparison below is case-insensitive.
  normalized text := lower(btrim(coalesce(search_text, '')));
  -- LIKE metacharacters neutralised. Backslash FIRST, or the escapes added for
  -- % and _ would themselves get escaped.
  escaped text;
  -- Caller may ask for less, never for more.
  capped_limit int := least(greatest(coalesce(result_limit, 10), 1), 50);
begin
  -- Below the floor there is no legitimate search, only enumeration.
  if length(normalized) < 3 then
    return;
  end if;

  escaped := replace(replace(replace(normalized, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select
    u.id,
    coalesce(p.display_name, '')::text as display_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where
    -- Exact, never a substring: see the ⚠️ note in the header. `escaped` is
    -- deliberately NOT used here — an escaped pattern is for LIKE, and this is
    -- an equality test on the raw normalized input.
    lower(u.email) = normalized
    or lower(coalesce(p.display_name, '')) like '%' || escaped || '%' escape '\'
    or lower(coalesce(p.username, '')) like '%' || escaped || '%' escape '\'
  order by
    -- No email branch: ranking by an email prefix would leak that prefix for a
    -- row the caller found by username or display name.
    case
      when lower(coalesce(p.username, '')) = normalized then 1
      when lower(coalesce(p.username, '')) like escaped || '%' escape '\' then 2
      when lower(coalesce(p.display_name, '')) = normalized then 3
      when lower(coalesce(p.display_name, '')) like escaped || '%' escape '\' then 4
      else 5
    end,
    coalesce(p.username, '')
  limit capped_limit;
end;
$$;

-- Kept for backward compatibility (zero callers in the app today; pruning dead
-- schema is tracked separately). Inherits every bound above by delegating.
create function public.search_user_by_email(search_email text)
returns table (
  id uuid,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select * from public.search_users_by_text(search_email, 1);
end;
$$;

-- Re-apply the exposure from 20260803000000. See the ⚠️ note above: the DROP
-- above threw the old grants away and Postgres has already granted EXECUTE to
-- PUBLIC on the functions just created.
revoke execute on function public.search_users_by_text(text, int) from public, anon;
revoke execute on function public.search_user_by_email(text) from public, anon;
grant execute on function public.search_users_by_text(text, int) to authenticated, service_role;
grant execute on function public.search_user_by_email(text) to authenticated, service_role;

comment on function public.search_users_by_text(text, int) is
  'Search users by username or display name (partial match) or by EXACT email; returns id + display_name only. SECURITY DEFINER over auth.users — MUST NOT be executable by anon (see 20260803000000), and every DROP must re-apply that revoke. Bounded by 20260804000000: min 3 chars, LIKE pattern escaped, limit capped at 50 server-side, email neither returned nor substring-matched (returning a stable id while matching a substring of the email is an oracle — see the migration header).';
comment on function public.search_user_by_email(text) is
  'Single-result wrapper over search_users_by_text. SECURITY DEFINER over auth.users — same exposure rules as its delegate (see 20260803000000 / 20260804000000).';
