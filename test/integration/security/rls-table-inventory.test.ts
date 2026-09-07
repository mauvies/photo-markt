/**
 * Inventory guard for row-level security across `public` (T-227).
 *
 * WHY THIS EXISTS: every table in `public` grants SELECT/INSERT/UPDATE/DELETE to
 * `anon` and `authenticated` — the Supabase bootstrap default, restored locally by
 * `supabase/seed.sql`. RLS is therefore not one layer of the defence, it is the
 * WHOLE defence. Before this ticket, 7 of 26 tables had ever been exercised
 * against an anon or foreign-authenticated client.
 *
 * The sibling of `security-definer-rpcs.test.ts`, and the same lesson: those RPCs
 * predated the revoke-from-anon convention, so no reviewer, test or lint ever
 * looked at them again until one of them was leaking every user's email. A table
 * added without a declared posture is the same shape of accident, so this test
 * makes the declaration mandatory rather than customary.
 *
 * Two layers, deliberately:
 *
 *   1. THE ALLOW-LIST — every table must declare `policies-tested` or
 *      `total-denial`, with a reason. Adding a table now fails this test until
 *      someone decides which it is.
 *
 *   2. PROPERTIES THAT NEED NO ALLOW-LIST — RLS actually enabled everywhere, no
 *      `using (true)`, no TRUNCATE for the API roles. These cannot be satisfied by
 *      declaring something; they are the assertions an allow-list cannot fake.
 *
 * ⚠️ Like the SECURITY DEFINER inventory, it asserts "nothing undeclared is
 * present", NOT "everything declared exists". Local and production have drifted
 * before (`sync_profile_avatar_url` is live in prod and in no migration), and the
 * reverse assertion would turn that into a permanent red build.
 *
 * No `resetDatabase` here: this reads the catalog, never the data.
 */

import { describe, expect, it } from 'vitest';
import { queryJson } from '../../helpers/db-catalog';

type Posture = 'policies-tested' | 'total-denial' | 'view-declares-security-invoker';

/**
 * The only columns the public projection exposes (T-268).
 *
 * ⚠️ `public_profiles` runs with OWNER rights (no `security_invoker`), which is
 * what lets it project rows the self-only policy on `profiles` hides. That makes
 * this list the security boundary: a private column added to the view is world
 * readable the moment it is added, with no policy left to catch it.
 */
const PUBLIC_PROFILE_COLUMNS = [
  'active_role',
  'avatar_url',
  'bio',
  'city',
  'country_code',
  'created_at',
  'display_name',
  'id',
  'slug',
  'username',
] as const;

/**
 * The only `profiles` columns a signed-in user may write (T-268).
 *
 * `profiles_self_update` restricts the ROW, not the columns, so without this
 * grant a photographer could repoint their own `stripe_connect_account_id` — the
 * transfer destination — straight through PostgREST. Mirrored at runtime by
 * `USER_WRITABLE_PROFILE_COLUMNS` in `src/database/queries/profiles.ts`.
 */
const USER_WRITABLE_PROFILE_COLUMNS = [
  'active_role',
  'address_line1',
  'address_line2',
  'avatar_url',
  'bio',
  'city',
  'country_code',
  'display_name',
  'full_name',
  'is_payout_profile_complete',
  'postal_code',
  'slug',
  'state_or_region',
  'updated_at',
  'username',
] as const;

/**
 * Every table in `public`, with the posture it is meant to have and why.
 *
 * `total-denial` means RLS enabled with ZERO policies: unreachable by `anon` and
 * `authenticated` no matter whose row it is, written only by `supabaseAdmin`.
 * That set is mirrored in `scripts/advisors-baseline.ts` under
 * `rls_enabled_no_policy` — the two lists are expected to agree.
 */
const EXPECTED_POSTURE: Record<string, { posture: Posture; why: string }> = {
  // ── Total denial: service-role only ──────────────────────────────────────
  admin_users: {
    posture: 'total-denial',
    why: 'admin gate; moved off profiles.is_admin by 20260513000000 because profiles has a public SELECT policy',
  },
  rate_limit_buckets: {
    posture: 'total-denial',
    why: 'reached only through the increment_rate_limit_bucket* SECURITY DEFINER RPCs',
  },
  subscriptions: {
    posture: 'total-denial',
    why: 'T-148 — written by the Stripe webhook; the user reads their plan through the app, not the table',
  },
  guest_orders: { posture: 'total-denial', why: 'guest checkout has no auth.uid() to scope by' },
  guest_order_items: { posture: 'total-denial', why: 'child of guest_orders' },
  pending_guest_checkouts: {
    posture: 'total-denial',
    why: 'pre-payment scratch space for the guest flow',
  },
  photos_orphan_storage_pending_cleanup: {
    posture: 'total-denial',
    why: 'internal queue for the storage-cleanup cron',
  },

  // ── The public projection (T-268) ────────────────────────────────────────
  public_profiles: {
    posture: 'view-declares-security-invoker',
    why: 'T-268: the ONLY public projection of profiles, owner rights ON PURPOSE (profiles is self-only, so an invoker view would return nothing). Its column list is the allow-list — see the column test below',
  },

  // ── Policy-protected, with behavioural tests ─────────────────────────────
  profiles: {
    posture: 'policies-tested',
    why: 'SELF-ONLY since T-268 — no policy admits another row; public data is served by the public_profiles view, and writes are column-granted',
  },
  events: {
    posture: 'policies-tested',
    why: 'owner-only; public browsing goes through service_role',
  },
  photos: { posture: 'policies-tested', why: 'owner-only by photos.user_id' },
  photo_faces: {
    posture: 'policies-tested',
    why: 'two-hop through photos→events; its is_public branch is unreachable (nested reads are RLS-filtered too) — see events-photos-rls.test.ts',
  },
  photo_bib_numbers: { posture: 'policies-tested', why: 'same two-hop shape as photo_faces' },
  carts: { posture: 'policies-tested', why: 'own cart by user_id' },
  cart_items: { posture: 'policies-tested', why: 'one hop through carts.user_id' },
  orders: { posture: 'policies-tested', why: 'buyer by user_id, photographer via the RPC helper' },
  order_items: { posture: 'policies-tested', why: 'one hop through orders.user_id; SELECT only' },
  payouts: { posture: 'policies-tested', why: 'photographer-read / service-role-write (T-216)' },
  download_tokens: { posture: 'policies-tested', why: 'claimant reads; no write policy at all' },
  event_photographers: {
    posture: 'policies-tested',
    why: 'two owners — event owner and invited photographer',
  },
  talent_photo_tags: { posture: 'policies-tested', why: 'tagged talent and photo owner' },
  talent_claimed_photos: { posture: 'policies-tested', why: 'own claims by talent_user_id' },
  talent_saved_events: { posture: 'policies-tested', why: 'own saves by user_id' },
  feedback: { posture: 'policies-tested', why: 'own rows; insert-and-read, no update or delete' },
  roadmap_votes: { posture: 'policies-tested', why: 'own votes by user_id' },
  user_role_memberships: {
    posture: 'policies-tested',
    why: 'self-service capability; the role enum bounds it, not RLS',
  },
  user_roles: {
    posture: 'policies-tested',
    why: 'DEAD but still present — empty, and no code reads it. Prune candidate; declared so it cannot be mistaken for live',
  },
};

interface TableRow {
  table_name: string;
  /** `pg_class.relkind` — 'r' table, 'p' partitioned, 'v' view, 'm' matview, 'f' foreign. */
  kind: string;
  rls_enabled: boolean;
  policy_count: number;
}

async function readTablePostures(): Promise<TableRow[]> {
  const rows = await queryJson<TableRow[] | null>(`
    select coalesce(json_agg(row_to_json(t)), '[]') from (
      select c.relname as table_name,
             c.relkind::text as kind,
             c.relrowsecurity as rls_enabled,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      -- NOT just ordinary tables ('r'). Partitioned tables ('p'), views ('v'),
      -- materialised views ('m') and foreign tables ('f') all live in public and
      -- are all covered by seed.sql's blanket grant on all tables. A VIEW is the
      -- sharpest of them: without security_invoker = on it runs as its owner and
      -- bypasses the base table's RLS entirely, so enumerating only 'r' would let
      -- exactly that ship green.
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      order by c.relname
    ) t;`);
  return rows ?? [];
}

describe('RLS table inventory — every public table declares a tested posture', () => {
  it('matches the declared allow-list exactly', async () => {
    const rows = await readTablePostures();
    expect(rows.length).toBeGreaterThan(0);

    // Derive the posture from the catalog: zero policies IS total denial, any
    // policy means the table is meant to be reachable and must be tested.
    //
    // ⚠️ A VIEW reports zero policies too, which would read as "total denial"
    // while it may in fact bypass RLS. It gets its own posture so it can never
    // be waved through by the same declaration a locked-down table uses.
    const actual = Object.fromEntries(
      rows.map((r) => [
        r.table_name,
        r.kind === 'v' || r.kind === 'm'
          ? ('view-declares-security-invoker' as Posture)
          : r.policy_count === 0
            ? ('total-denial' as Posture)
            : ('policies-tested' as Posture),
      ]),
    );

    // Compare only against tables that exist HERE — see the header note on drift.
    const expected = Object.fromEntries(
      Object.keys(actual).map((name) => {
        const declared = EXPECTED_POSTURE[name];
        return [name, declared ? declared.posture : `UNDECLARED_TABLE:${name}`];
      }),
    );

    // One object comparison so the diff names the offending table and the posture
    // that drifted, rather than just "expected 'total-denial' to be …".
    //
    // If this fails because you ADDED a table: that is the point. Decide whether
    // it is service-role-only (no policies) or user-reachable (policies + a
    // behavioural test in this directory), then declare it above.
    //
    // If it fails because a table GAINED or LOST policies: a table that was
    // service-role-only is now reachable, or a policy someone relied on is gone.
    // Neither should happen silently.
    expect(actual).toEqual(expected);
  });

  it('every table in public has row-level security enabled', async () => {
    // Needs no allow-list: with `grant all` to anon on every table, RLS off is
    // an open table, whatever anyone declared about it.
    const rows = await readTablePostures();
    // Views and materialised views carry no `relrowsecurity` of their own — they
    // inherit (or bypass) the base table's. They are checked by the view test
    // below instead.
    const unprotected = rows
      .filter((r) => (r.kind === 'r' || r.kind === 'p') && !r.rls_enabled)
      .map((r) => r.table_name);

    expect(unprotected).toEqual([]);
  });

  it('no policy is permissive to everyone', async () => {
    // `USING (true)` is forbidden by CLAUDE.md on tables with sensitive writes,
    // and there is no table here where it would be right.
    const permissive = await queryJson<string[]>(`
      select coalesce(json_agg(tablename || '.' || policyname), '[]')
      from pg_policies
      where schemaname = 'public'
        and (btrim(coalesce(qual, '')) = 'true' or btrim(coalesce(with_check, '')) = 'true');`);

    expect(permissive).toEqual([]);
  });

  it('neither anon nor authenticated can TRUNCATE any table', async () => {
    // TRUNCATE is NOT subject to RLS, so on a table whose only protection is RLS
    // it bypasses the entire model. Revoked by 20260906000000; `seed.sql` cannot
    // restore it because its blanket grant covers only SELECT/INSERT/UPDATE/DELETE.
    const truncatable = await queryJson<string[]>(`
      select coalesce(json_agg(c.relname), '[]')
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and (has_table_privilege('anon', c.oid, 'TRUNCATE')
          or has_table_privilege('authenticated', c.oid, 'TRUNCATE'));`);

    expect(truncatable).toEqual([]);
  });

  it('the public projection exposes exactly the declared columns', async () => {
    // ⚠️ The list lives in the migration (the view's select), `supabase/seed.sql`
    // and this constant. Prose saying "keep these identical" is not a mechanism;
    // reading it back from the catalog is. The local DB is migrations THEN seed,
    // so a seed that drifts shows up here rather than as a silent local/prod
    // divergence.
    const columns = await queryJson<string[]>(`
      select coalesce(json_agg(attname order by attname), '[]')
      from pg_attribute
      where attrelid = 'public.public_profiles'::regclass and attnum > 0 and not attisdropped;`);

    expect(columns).toEqual([...PUBLIC_PROFILE_COLUMNS].sort());
  });

  it('anon holds no privilege on profiles at all', async () => {
    // T-268 retired T-227's column grants: anon reads the view, so it has no
    // business on the table. A later `grant … on all tables to anon` would
    // re-open every private column, and this is what catches it.
    const privileges = await queryJson<string[]>(`
      select coalesce(json_agg(distinct privilege_type order by privilege_type), '[]')
      from information_schema.table_privileges
      where table_schema = 'public' and table_name = 'profiles' and grantee = 'anon';`);

    expect(privileges).toEqual([]);
  });

  it('a signed-in user may write only the editable profile columns', async () => {
    const writable = await queryJson<string[]>(`
      select coalesce(json_agg(distinct column_name order by column_name), '[]')
      from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'profiles'
        and grantee = 'authenticated' and privilege_type = 'UPDATE';`);

    expect(writable).toEqual([...USER_WRITABLE_PROFILE_COLUMNS].sort());
  });

  it('the payout destination columns are writable by nobody but the service role', async () => {
    // Stated as the property rather than as the absence of a grant, so it holds
    // however the allow-list above is edited.
    const grantees = await queryJson<string[]>(`
      select coalesce(json_agg(distinct grantee order by grantee), '[]')
      from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('stripe_connect_account_id', 'stripe_connect_status')
        and privilege_type in ('INSERT', 'UPDATE')
        and grantee in ('anon', 'authenticated');`);

    expect(grantees).toEqual([]);
  });
});
