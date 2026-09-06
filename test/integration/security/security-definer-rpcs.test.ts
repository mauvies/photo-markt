/**
 * Regression + inventory guard for SECURITY DEFINER RPCs (2026-08-03 finding).
 *
 * THE BUG THIS PINS: `search_users_by_text`, `search_user_by_email` and
 * `get_user_emails_batch` select email out of `auth.users` under SECURITY
 * DEFINER, and all three were executable by `anon` — i.e. by anyone holding the
 * publishable anon key, which ships in the browser bundle. One unauthenticated
 * POST to /rest/v1/rpc/search_users_by_text with search_text="@" returned every
 * registered user's email and display name (the argument is interpolated into a
 * LIKE pattern unescaped, and `result_limit` has no server-side ceiling).
 *
 * Postgres grants EXECUTE to PUBLIC by default, so the original migrations'
 * `grant execute ... to authenticated` READ like a restriction while being purely
 * additive. Fixed by 20260803000000.
 *
 * Two layers here, on purpose:
 *
 *   1. BEHAVIOURAL — anon actually cannot call them; authenticated still can (the
 *      live features in queries/profiles.ts, queries/sales.ts and
 *      events/[id]/actions.ts must keep working).
 *
 *   2. INVENTORY — every SECURITY DEFINER function in `public` must appear in the
 *      allow-list below with its exact expected exposure. This is the layer that
 *      would have caught the original bug: the functions predated the
 *      revoke-from-anon convention in CLAUDE.md, so no reviewer, test or lint ever
 *      looked at them again. Adding a new SECURITY DEFINER function now fails this
 *      test until its exposure is declared deliberately.
 *
 * The inventory reads privileges through `test/helpers/db-catalog.ts`, which runs
 * psql inside the local Supabase db container — supabase-js cannot execute
 * arbitrary SQL. The RLS table inventory (T-227) shares that helper.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { execSql, queryJson } from '../../helpers/db-catalog';
import {
  createAnonClient,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

/**
 * Declared exposure of every SECURITY DEFINER function in `public`.
 *
 * A SECURITY DEFINER function runs with its owner's privileges and therefore
 * BYPASSES RLS — it is the one construct in the schema that row-level policies
 * cannot protect. Each entry states who may execute it and why.
 */
const EXPECTED_EXPOSURE: Record<string, { anon: boolean; authenticated: boolean; why: string }> = {
  // Reads auth.users. Anon access was the vulnerability (20260803000000).
  // Authenticated access stays — the tag-talent dialog needs it — but the
  // function itself is now bounded by 20260804000000 (min 3 chars, escaped LIKE,
  // limit capped at 50, email never returned); see the describe block below.
  // It was dropped and recreated by that migration, which resets grants and
  // re-grants EXECUTE to PUBLIC by default: this entry staying false for anon IS
  // the assertion that the re-revoke was not forgotten.
  //
  // ⚠️ `search_user_by_email` used to sit alongside it. T-219 dropped that
  // function outright (zero callers), so its ABSENCE from this allow-list is now
  // the guard: the inventory below fails if it ever comes back undeclared.
  search_users_by_text: { anon: false, authenticated: true, why: 'tag-talent search' },
  get_user_emails_batch: { anon: false, authenticated: true, why: 'buyer emails on sales tab' },

  // Rate-limit counters: service-role only. These got the revoke right in
  // 20260514000001 and are the control case proving the mechanism works.
  increment_rate_limit_bucket: { anon: false, authenticated: false, why: 'service-role only' },
  increment_rate_limit_bucket_by: { anon: false, authenticated: false, why: 'service-role only' },

  // Reversal arithmetic on `payouts.reversed_amount_cents` (T-260). Service-role
  // only for the same reason as the rate-limit counters, but with more at stake:
  // `payouts` is photographer-read / service-role-write, and these move a money
  // column. Reachable with the anon key they would let anyone rewrite a
  // photographer's balance.
  reserve_payout_reversal: { anon: false, authenticated: false, why: 'service-role only' },
  release_payout_reversal: { anon: false, authenticated: false, why: 'service-role only' },

  // Trigger function: invoked by the trigger, never as an RPC. Triggers do not
  // check EXECUTE on the calling role, so no API role needs it.
  sync_profile_avatar_url: { anon: false, authenticated: false, why: 'trigger only' },

  // KNOWN EXCEPTION, deliberate: referenced from the `orders` RLS policy
  // "Photographers can view orders for their photos". A policy helper is
  // evaluated with the querying role's privileges, so revoking EXECUTE turns an
  // anon SELECT on `orders` from "empty result" into "permission denied for
  // function". Its leak is a boolean oracle already requiring two unguessable
  // UUIDs, so the fix is riskier than the bug today. Tracked separately.
  order_has_photographer_items: {
    anon: true,
    authenticated: true,
    why: 'orders RLS policy helper — see 20260803000000 header',
  },
};

type ProcRow = { proname: string; anon: boolean; authenticated: boolean };

async function readSecurityDefinerExposure(): Promise<ProcRow[]> {
  const rows = await queryJson<ProcRow[] | null>(`
    select coalesce(json_agg(row_to_json(t)), '[]') from (
      select p.proname,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
      order by p.proname
    ) t;`);
  return rows ?? [];
}

describe('SECURITY DEFINER RPCs — anon email enumeration regression', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('anon cannot enumerate user emails via search_users_by_text', async () => {
    await createTestUser('TALENT');

    const { data, error } = await createAnonClient().rpc('search_users_by_text', {
      search_text: '@',
      result_limit: 1000,
    });

    // The exact surfacing varies (42501 permission denied, or PGRST202 "function
    // not found" once EXECUTE is gone). What must hold is that no row comes back.
    expect(error).not.toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('anon cannot resolve emails from known user ids via get_user_emails_batch', async () => {
    const user = await createTestUser('TALENT');

    const { data, error } = await createAnonClient().rpc('get_user_emails_batch', {
      user_ids: [user.id],
    });

    expect(error).not.toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('authenticated users can still search — the invite feature keeps working', async () => {
    const target = await createTestUser('PHOTOGRAPHER');
    const caller = await createTestUser('PHOTOGRAPHER');
    const callerClient = await signInAs(caller.email);

    const { data, error } = await callerClient.rpc('search_users_by_text', {
      search_text: target.email,
      result_limit: 10,
    });

    expect(error).toBeNull();
    expect((data ?? []).some((r: { id: string }) => r.id === target.id)).toBe(true);
  });

  it('authenticated users can still resolve buyer emails — the sales tab keeps working', async () => {
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const client = await signInAs(photographer.email);

    const { data, error } = await client.rpc('get_user_emails_batch', { user_ids: [buyer.id] });

    expect(error).toBeNull();
    expect((data ?? [])[0]?.email).toBe(buyer.email);
  });
});

/**
 * T-226: revoking anon (20260803000000) stopped the anonymous dump, but any
 * AUTHENTICATED user could still empty the roster — signing up is free Google
 * OAuth, and the RPC is callable straight through PostgREST with a user JWT, so
 * the Server Action wrapping it guards nothing. 20260804000000 bounds the
 * function itself: min 3 chars, escaped LIKE pattern, server-side limit ceiling,
 * and no email column at all.
 */
describe('search_users_by_text — bounded for authenticated callers (T-226)', () => {
  /** Distinctive enough that only rows seeded by this file can match it. */
  const ROSTER_PREFIX = 'bulkroster226';

  beforeEach(async () => {
    await resetDatabase();
  });

  /**
   * Seed `n` users that the RPC can find. The match has to come from `username`,
   * not from the email: email is matched by EXACT equality only (see the oracle
   * test below), so a shared email prefix would find nobody.
   */
  async function seedRoster(n: number): Promise<void> {
    await execSql(`
      insert into auth.users (id, email)
      select gen_random_uuid(), '${ROSTER_PREFIX}-' || g || '@photomarkt.test'
      from generate_series(1, ${n}) g;

      insert into public.profiles (id, username, active_role)
      select u.id, '${ROSTER_PREFIX}_' || substr(u.id::text, 1, 8), 'TALENT'
      from auth.users u
      where u.email like '${ROSTER_PREFIX}%'
      on conflict (id) do update set username = excluded.username;`);
  }

  async function deleteRoster(): Promise<void> {
    await execSql(`delete from auth.users where email like '${ROSTER_PREFIX}%'`);
  }

  it('caps result_limit server-side — a caller asking for a million gets 50', async () => {
    // 60 users via psql: the ceiling is only observable above it, and 60 admin
    // API calls would dominate the runtime of this file.
    await seedRoster(60);

    try {
      const caller = await createTestUser('PHOTOGRAPHER');
      const client = await signInAs(caller.email);

      const { data, error } = await client.rpc('search_users_by_text', {
        search_text: ROSTER_PREFIX,
        result_limit: 1000000,
      });

      expect(error).toBeNull();
      // Before 20260804000000 this returned all 60.
      expect((data ?? []).length).toBe(50);
    } finally {
      // Explicit, not left to resetDatabase: these rows were inserted behind the
      // admin API's back, so the next beforeEach should never have to see them.
      await deleteRoster();
    }
  });

  it('a caller asking for fewer than the cap still gets what it asked for', async () => {
    await seedRoster(5);

    try {
      const caller = await createTestUser('PHOTOGRAPHER');
      const client = await signInAs(caller.email);

      const { data, error } = await client.rpc('search_users_by_text', {
        search_text: ROSTER_PREFIX,
        result_limit: 3,
      });

      expect(error).toBeNull();
      expect((data ?? []).length).toBe(3);
    } finally {
      await deleteRoster();
    }
  });

  it('"@" returns nothing instead of every email on the platform', async () => {
    await createTestUser('TALENT');
    const caller = await createTestUser('PHOTOGRAPHER');
    const client = await signInAs(caller.email);

    const { data, error } = await client.rpc('search_users_by_text', {
      search_text: '@',
      result_limit: 1000000,
    });

    // Zero, not "at most 50": the 3-character floor rejects it before the cap
    // ever applies. This is the exact payload from the original finding.
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('treats "%" as a literal, not as a wildcard', async () => {
    await createTestUser('TALENT');
    const caller = await createTestUser('PHOTOGRAPHER');
    const client = await signInAs(caller.email);

    // 3 characters, so it clears the length floor and only the LIKE escaping can
    // stop it. Unescaped, '%%%' matches every row.
    const { data, error } = await client.rpc('search_users_by_text', {
      search_text: '%%%',
      result_limit: 1000000,
    });

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('treats "_" as a literal, not as a single-character wildcard', async () => {
    const literal = await createTestUser('TALENT', {
      username: 'escliteral',
      display_name: 'a_b',
    });
    const wildcard = await createTestUser('TALENT', {
      username: 'escwildcard',
      display_name: 'axb',
    });
    const caller = await createTestUser('PHOTOGRAPHER');
    const client = await signInAs(caller.email);

    const { data, error } = await client.rpc('search_users_by_text', {
      search_text: 'a_b',
      result_limit: 50,
    });

    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    expect(ids).toContain(literal.id);
    expect(ids).not.toContain(wildcard.id);
  });

  it('returns nothing for searches shorter than 3 characters', async () => {
    const target = await createTestUser('TALENT', {
      username: 'shortsearch',
      display_name: 'Zoe',
    });
    const caller = await createTestUser('PHOTOGRAPHER');
    const client = await signInAs(caller.email);

    // 'zo' would match the target's display name if the floor weren't there.
    const { data, error } = await client.rpc('search_users_by_text', {
      search_text: 'zo',
      result_limit: 50,
    });

    expect(error).toBeNull();
    expect((data ?? []).map((r: { id: string }) => r.id)).not.toContain(target.id);
    expect(data ?? []).toEqual([]);
  });

  it('never returns an email column', async () => {
    const target = await createTestUser('TALENT');
    const caller = await createTestUser('PHOTOGRAPHER');
    const client = await signInAs(caller.email);

    const { data, error } = await client.rpc('search_users_by_text', {
      search_text: target.email,
      result_limit: 50,
    });

    expect(error).toBeNull();
    const row = (data ?? [])[0];
    expect(row).toBeDefined();
    // The whole point of the T-226 narrowing: the column is gone, not filtered
    // by the caller. The only consumer already discarded it.
    expect(Object.keys(row as object)).not.toContain('email');
  });

  it('does not answer substring probes against an email — no character-by-character oracle', async () => {
    // The finding that survived the first pass of this ticket: dropping the
    // email COLUMN is not enough while the WHERE still matches a substring of it
    // and the function returns a stable id. That pair is an oracle — an attacker
    // holding a target's uuid (photographer ids are public via profile slugs)
    // anchors on the domain and walks left one character at a time. Reproduced
    // before the fix; these two probes are the exact shape of that attack.
    const target = await createTestUser('TALENT', {
      email: 'victim-secret-1987@photomarkt.test',
      username: 'oracletarget',
      display_name: 'Oracle Target',
    });
    const caller = await createTestUser('PHOTOGRAPHER');
    const client = await signInAs(caller.email);

    const domainProbe = await client.rpc('search_users_by_text', {
      search_text: 'photomarkt.test',
      result_limit: 50,
    });
    expect(domainProbe.error).toBeNull();
    expect((domainProbe.data ?? []).map((r: { id: string }) => r.id)).not.toContain(target.id);

    // An anchor being extended leftwards: a real suffix of the address, which a
    // substring match would confirm.
    const suffixProbe = await client.rpc('search_users_by_text', {
      search_text: '7@photomarkt.test',
      result_limit: 50,
    });
    expect(suffixProbe.error).toBeNull();
    expect((suffixProbe.data ?? []).map((r: { id: string }) => r.id)).not.toContain(target.id);
  });

  it('still finds a user by their full email — the tag-talent flow keeps working', async () => {
    const target = await createTestUser('TALENT');
    const caller = await createTestUser('PHOTOGRAPHER');
    const client = await signInAs(caller.email);

    const { data, error } = await client.rpc('search_users_by_text', {
      search_text: target.email,
      result_limit: 10,
    });

    expect(error).toBeNull();
    expect((data ?? []).some((r: { id: string }) => r.id === target.id)).toBe(true);
  });

  it('still finds a user by a partial display name', async () => {
    const target = await createTestUser('TALENT', {
      username: 'partialname',
      display_name: 'Mariana Ruiz',
    });
    const caller = await createTestUser('PHOTOGRAPHER');
    const client = await signInAs(caller.email);

    const { data, error } = await client.rpc('search_users_by_text', {
      search_text: 'rian',
      result_limit: 10,
    });

    expect(error).toBeNull();
    expect((data ?? []).some((r: { id: string }) => r.id === target.id)).toBe(true);
  });
});

describe('SECURITY DEFINER inventory — every such function declares its exposure', () => {
  it('matches the declared allow-list exactly', async () => {
    const rows = await readSecurityDefinerExposure();

    const actual = Object.fromEntries(
      rows.map((r) => [r.proname, { anon: r.anon, authenticated: r.authenticated }]),
    );
    // Compare only against functions that exist HERE. The assertion is "nothing
    // undeclared is exposed", not "everything declared exists": prod and local
    // have drifted (see the migration header — `sync_profile_avatar_url` is live
    // in prod but created by no migration), and a declared-but-absent entry is
    // not a security problem. An undeclared PRESENT one always is.
    const expected = Object.fromEntries(
      Object.keys(actual).map((name) => {
        const declared = EXPECTED_EXPOSURE[name];
        return [
          name,
          declared
            ? { anon: declared.anon, authenticated: declared.authenticated }
            : { UNDECLARED_SECURITY_DEFINER_FUNCTION: name },
        ];
      }),
    );

    // A single object comparison so the diff names the offending function and the
    // privilege that drifted, rather than just "expected true to be false".
    //
    // If this fails because you ADDED a SECURITY DEFINER function: that is the
    // point. Decide its exposure, `revoke execute ... from public, anon` in the
    // migration (Postgres grants PUBLIC by default — a bare `grant to
    // authenticated` does NOT restrict anything), then declare it above.
    expect(actual).toEqual(expected);
  });

  it('no SECURITY DEFINER function reachable by anon reads auth.users', async () => {
    // The blunt, intent-level assertion: whatever the allow-list says, nothing
    // that touches the user table may be callable without signing in. This is the
    // one that states the actual security property rather than a permission bit.
    const leaky = await queryJson<string[]>(`
      select coalesce(json_agg(p.proname), '[]') from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and has_function_privilege('anon', p.oid, 'EXECUTE')
        and pg_get_functiondef(p.oid) ilike '%auth.users%';`);

    expect(leaky).toEqual([]);
  });
});
