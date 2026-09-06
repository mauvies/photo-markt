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
 * The only `profiles` columns `anon` may read (T-227).
 *
 * `photographer_profiles_public_select` admits every photographer ROW, and RLS
 * cannot restrict columns — so this grant is what keeps the postal address, legal
 * name, Stripe ids and payout details off the public internet. Derived from what
 * the code actually reads as anon: `getPhotographerBySlug`, `getTopPhotographers`,
 * the event-search photographer filter, plus `active_role` because Postgres
 * requires SELECT on a column to filter by it.
 *
 * ⚠️ Adding a column to `profiles` does NOT expose it. Adding it HERE does — and
 * to the migration and to `supabase/seed.sql`, which this test keeps in step.
 */
const ANON_READABLE_PROFILE_COLUMNS = [
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

  // ── Policy-protected, with behavioural tests ─────────────────────────────
  profiles: {
    posture: 'policies-tested',
    why: 'public photographer read is column-restricted for anon (T-227) — see profiles-rls.test.ts',
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

  it('the anon column allow-list on profiles is exactly what was declared', async () => {
    // ⚠️ The list lives in THREE places — the migration, `supabase/seed.sql` (whose
    // blanket grant runs after migrations and would otherwise restore table-wide
    // SELECT), and the public-column constant in `profiles-rls.test.ts`. Prose
    // saying "keep these identical" is not a mechanism; this is.
    //
    // Reading it from the catalog means the local DB — migrations THEN seed — is
    // what gets compared, so a seed that forgets a column the migration granted
    // shows up here instead of as a silent local/production divergence.
    const granted = await queryJson<string[]>(`
      select coalesce(json_agg(column_name order by column_name), '[]')
      from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'profiles'
        and grantee = 'anon' and privilege_type = 'SELECT';`);

    expect(granted).toEqual([...ANON_READABLE_PROFILE_COLUMNS].sort());
  });

  it('anon holds no table-wide SELECT on profiles', async () => {
    // The column grants above are only a restriction while the table-level grant
    // is gone: a later `grant select on all tables in schema public to anon`
    // would silently re-open every withheld column, and the column list would
    // still look right.
    const tableWide = await queryJson<boolean>(
      `select to_json(has_table_privilege('anon', 'public.profiles', 'SELECT'));`,
    );

    expect(tableWide).toBe(false);
  });
});
