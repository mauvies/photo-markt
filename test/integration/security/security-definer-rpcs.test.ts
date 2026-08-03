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
 * The inventory reads privileges by running psql INSIDE the local Supabase db
 * container, because supabase-js cannot execute arbitrary SQL and `psql` is not
 * reliably on PATH (this repo has no local Postgres install — `pnpm db:seed`
 * happens to work only where one exists). The integration suite already requires
 * Docker + `supabase start`, so the container is guaranteed to be there in both
 * local runs and CI.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAnonClient,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

const execFileAsync = promisify(execFile);

/** Resolved once — the running `supabase_db_<project>` container. */
let dbContainer: string | null = null;

async function resolveDbContainer(): Promise<string> {
  if (dbContainer) return dbContainer;
  const { stdout } = await execFileAsync('docker', [
    'ps',
    '--filter',
    'name=supabase_db',
    '--format',
    '{{.Names}}',
  ]);
  const name = stdout.trim().split('\n').filter(Boolean)[0];
  if (!name) {
    throw new Error(
      'No running supabase_db container found. Start the local stack with `pnpm db:start`.',
    );
  }
  dbContainer = name;
  return name;
}

/** Run a scalar-returning query in the local DB and parse its JSON result. */
async function queryJson<T>(sql: string): Promise<T> {
  const container = await resolveDbContainer();
  const { stdout } = await execFileAsync('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-tAc',
    sql,
  ]);
  return JSON.parse(stdout.trim() || 'null') as T;
}

/**
 * Declared exposure of every SECURITY DEFINER function in `public`.
 *
 * A SECURITY DEFINER function runs with its owner's privileges and therefore
 * BYPASSES RLS — it is the one construct in the schema that row-level policies
 * cannot protect. Each entry states who may execute it and why.
 */
const EXPECTED_EXPOSURE: Record<string, { anon: boolean; authenticated: boolean; why: string }> = {
  // Reads auth.users. Anon access was the vulnerability. Authenticated access is
  // still broader than ideal (any signed-in user can enumerate the user table) —
  // narrowing that is a tracked follow-up, not a regression.
  search_users_by_text: { anon: false, authenticated: true, why: 'contributor invite search' },
  search_user_by_email: { anon: false, authenticated: true, why: 'contributor invite by email' },
  get_user_emails_batch: { anon: false, authenticated: true, why: 'buyer emails on sales tab' },

  // Rate-limit counters: service-role only. These got the revoke right in
  // 20260514000001 and are the control case proving the mechanism works.
  increment_rate_limit_bucket: { anon: false, authenticated: false, why: 'service-role only' },
  increment_rate_limit_bucket_by: { anon: false, authenticated: false, why: 'service-role only' },

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

  it('anon cannot enumerate user emails via search_user_by_email', async () => {
    const user = await createTestUser('TALENT');

    const { data, error } = await createAnonClient().rpc('search_user_by_email', {
      search_email: user.email,
    });

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
