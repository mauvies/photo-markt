/**
 * `profiles` read surface (T-227).
 *
 * THE BUG THIS PINS: `photographer_profiles_public_select` is
 * `using (active_role = 'PHOTOGRAPHER')`, and RLS is ROW-level — a policy that
 * admits the row admits every COLUMN of it. With the Supabase default `grant all`
 * for `anon`, one unauthenticated request returned the photographer's legal name,
 * full postal address, Stripe customer/Connect ids and the payout-details jsonb:
 *
 *   GET /rest/v1/profiles?select=full_name,address_line1,stripe_connect_account_id
 *
 * `active_role` DEFAULTS to 'PHOTOGRAPHER', so it reached almost every row.
 * Closed by 20260906000000 with a column grant, which also makes the grant list an
 * allow-list: a column added to `profiles` is no longer public by default.
 *
 * ⚠️ KNOWN GAP, deliberate and split into its own ticket: `authenticated` is NOT
 * column-restricted, so any signed-in user can still read another photographer's
 * address. A column grant is per-role and cannot tell "my row" from "someone
 * else's", so restricting it would break a photographer reading their own address
 * in settings — closing it needs the columns moved out of `profiles`. The gap is
 * asserted below rather than left implicit, so it stays a recorded decision.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  createAnonClient,
  createServiceClient,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

/** Columns the public photographer profile and the search actually read. */
const PUBLIC_COLUMNS = 'id, username, slug, display_name, bio, avatar_url, city, country_code';

/** Columns that must never reach an unauthenticated caller. */
const SENSITIVE_COLUMNS = [
  'full_name',
  'address_line1',
  'address_line2',
  'postal_code',
  'state_or_region',
  'stripe_customer_id',
  'stripe_connect_account_id',
  'payout_details_json',
  'payout_method',
];

describe('profiles RLS — the anon read surface', () => {
  let photographer: { id: string; email: string; username: string };

  // ⚠️ `beforeAll`, not the usual `beforeEach(resetDatabase)`: every test here
  // either reads or asserts a refused read, so nothing mutates and ordering
  // cannot quietly pass or fail one. The integration suite runs with
  // `fileParallelism: false`, so a reset per test is pure wall-clock.
  beforeAll(async () => {
    await resetDatabase();
    photographer = await createTestUser('PHOTOGRAPHER');
    const { error } = await createServiceClient()
      .from('profiles')
      .update({
        full_name: 'Legal Name',
        address_line1: '221B Baker St',
        postal_code: '28001',
        city: 'Madrid',
        country_code: 'ES',
        stripe_customer_id: 'cus_secret',
        stripe_connect_account_id: 'acct_secret',
        payout_method: 'bank_transfer',
        payout_details_json: { iban: 'ES9121000418450200051332' },
      })
      .eq('id', photographer.id);
    if (error) throw new Error(`profile seed failed: ${error.message}`);
  });

  it.each(SENSITIVE_COLUMNS)('anon cannot read profiles.%s', async (column) => {
    const { data, error } = await createAnonClient().from('profiles').select(column);

    // A column-level grant makes PostgREST refuse the whole request rather than
    // null the column out — the request never reaches a row.
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('anon cannot read profiles with select(*)', async () => {
    // The blunt instrument an attacker reaches for first, and the reason the fix
    // had to be a grant rather than a narrower policy: `*` expands to every
    // column, so it fails as a whole.
    const { data, error } = await createAnonClient().from('profiles').select('*');

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('anon can still read the public photographer profile', async () => {
    // Positive control, and the exact column list `getPhotographerBySlug` uses
    // (`src/database/queries/photographers.ts`). If this breaks, the public
    // profile page 500s — so it is what keeps the grant list honest.
    const { data, error } = await createAnonClient()
      .from('profiles')
      .select(`${PUBLIC_COLUMNS}, created_at`)
      .eq('id', photographer.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ username: photographer.username, city: 'Madrid' });
  });

  it('anon can still filter photographers by active_role', async () => {
    // `searchPhotographers` filters on `active_role`, and Postgres requires
    // SELECT on a column to filter by it — so the grant must include it even
    // though nothing renders it.
    const { data, error } = await createAnonClient()
      .from('profiles')
      .select(PUBLIC_COLUMNS)
      .eq('active_role', 'PHOTOGRAPHER');

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it('a signed-in user can still read their own full profile', async () => {
    // The settings pages read every column of the caller's own row via
    // `getProfile`'s `select('*')`. Restricting `authenticated` by column would
    // break exactly this, which is why that half is a schema change, not a grant.
    const client = await signInAs(photographer.email);
    const { data, error } = await client.from('profiles').select('*').eq('id', photographer.id);

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ full_name: 'Legal Name', address_line1: '221B Baker St' });
  });

  it('KNOWN GAP: a signed-in user can still read another photographer stripe id and address', async () => {
    // ⚠️ Not a passing security property — a recorded one. `authenticated` keeps
    // table-wide SELECT, and `photographer_profiles_public_select` admits every
    // photographer row, so any account (Google sign-up, seconds to obtain) reads
    // this. Fixing it means moving the columns out of `profiles`; tracked as its
    // own ticket. This test exists so the day that lands, it fails and is updated
    // deliberately instead of the gap being rediscovered from scratch.
    const stranger = await createTestUser('TALENT');
    const strangerClient = await signInAs(stranger.email);

    const { data, error } = await strangerClient
      .from('profiles')
      .select('id, full_name, address_line1, stripe_connect_account_id')
      .eq('id', photographer.id);

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      full_name: 'Legal Name',
      stripe_connect_account_id: 'acct_secret',
    });
  });

  it('KNOWN GAP: a user can rewrite their OWN stripe connect columns through PostgREST', async () => {
    // ⚠️ The column allow-list is SELECT only. `authenticated` keeps table-wide
    // INSERT/UPDATE, and `profiles_self_update` restricts the ROW (`id =
    // auth.uid()`) but not the columns — so the payout destination the app treats
    // as system-managed is user-writable, bypassing the Server Action entirely.
    //
    // Bounded, which is why it is recorded rather than rushed: every money path
    // re-derives the status from Stripe via `reconcileAndPersistConnectStatus`
    // before transferring, and pointing one's OWN payout account elsewhere is
    // self-harm, not theft. Closing it means moving
    // `updateProfileStripeConnect`'s dashboard call site to `supabaseAdmin` first
    // (it uses the user's client today) — tracked in T-268 with the read half.
    //
    // This test FAILS when that lands. That is the signal to update it.
    const client = await signInAs(photographer.email);

    const { data, error } = await client
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_attacker_controlled' })
      .eq('id', photographer.id)
      .select('id, stripe_connect_account_id');

    expect(error).toBeNull();
    expect(data?.[0]?.stripe_connect_account_id).toBe('acct_attacker_controlled');

    // Restore, so the ordering-independence this file relies on still holds.
    await createServiceClient()
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_secret' })
      .eq('id', photographer.id);
  });

  it('a user cannot update another user profile', async () => {
    const stranger = await createTestUser('TALENT', { email: `stranger-w-${Date.now()}@test.dev` });
    const strangerClient = await signInAs(stranger.email);

    const { data, error } = await strangerClient
      .from('profiles')
      .update({ display_name: 'hijacked' })
      .eq('id', photographer.id)
      .select();

    // No UPDATE policy admits someone else's row: RLS filters it out, so the
    // request succeeds and touches nothing. The canonical assertion is the re-read.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await createServiceClient()
      .from('profiles')
      .select('display_name')
      .eq('id', photographer.id)
      .single();
    expect(after?.display_name).not.toBe('hijacked');
  });
});
