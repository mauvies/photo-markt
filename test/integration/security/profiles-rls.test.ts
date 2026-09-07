/**
 * `profiles` read and write surface (T-227, closed by T-268).
 *
 * THE BUG THIS PINS: `photographer_profiles_public_select` was
 * `using (active_role = 'PHOTOGRAPHER')`, and RLS is ROW-level — a policy that
 * admits the row admits every COLUMN of it. With Supabase's default `grant all`,
 * one request returned the photographer's legal name, full postal address and
 * Stripe ids:
 *
 *   GET /rest/v1/profiles?select=full_name,address_line1,stripe_connect_account_id
 *
 * `active_role` DEFAULTS to 'PHOTOGRAPHER', so it reached almost every row.
 * T-227 closed the `anon` half with column grants; T-268 closed the rest by
 * removing the policy outright:
 *
 *   * READ — `profiles` is now SELF-ONLY. No policy admits another user's row,
 *     for any role. Public profile data is served by the `public_profiles` view,
 *     whose select list is the allow-list.
 *   * WRITE — `authenticated` holds column-level INSERT/UPDATE on the editable
 *     columns only, so `stripe_connect_*` (the transfer destination) is
 *     unwritable by the user even on their own row.
 *
 * The two tests that used to assert those gaps as KNOWN GAP now assert the
 * opposite; they are the regression for T-268.
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

/** Columns that must never reach anyone but their owner. */
const SENSITIVE_COLUMNS = [
  'full_name',
  'address_line1',
  'address_line2',
  'postal_code',
  'state_or_region',
  'stripe_connect_account_id',
  'stripe_connect_status',
];

describe('profiles RLS — the read surface', () => {
  let photographer: { id: string; email: string; username: string };
  let stranger: { id: string; email: string };

  // ⚠️ `beforeAll`, not the usual `beforeEach(resetDatabase)`: every test here
  // either reads or asserts a refused write, so nothing mutates and ordering
  // cannot quietly pass or fail one. The integration suite runs with
  // `fileParallelism: false`, so a reset per test is pure wall-clock.
  beforeAll(async () => {
    await resetDatabase();
    photographer = await createTestUser('PHOTOGRAPHER');
    stranger = await createTestUser('TALENT');
    const { error } = await createServiceClient()
      .from('profiles')
      .update({
        full_name: 'Legal Name',
        address_line1: '221B Baker St',
        postal_code: '28001',
        city: 'Madrid',
        country_code: 'ES',
        stripe_connect_account_id: 'acct_secret',
        stripe_connect_status: 'active',
      })
      .eq('id', photographer.id);
    if (error) throw new Error(`profile seed failed: ${error.message}`);
  });

  it.each(SENSITIVE_COLUMNS)('anon cannot read profiles.%s', async (column) => {
    const { data, error } = await createAnonClient().from('profiles').select(column);

    // anon holds no privilege on the table at all now — it reads the view.
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('anon cannot read profiles at all, not even the public columns', async () => {
    const { data, error } = await createAnonClient().from('profiles').select(PUBLIC_COLUMNS);

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it.each(
    SENSITIVE_COLUMNS,
  )('a signed-in stranger cannot read another photographer %s', async (column) => {
    // ⚠️ THE T-268 REGRESSION. This used to be a KNOWN GAP test asserting the
    // opposite: any account — a Google sign-up takes seconds — could read the
    // legal name, postal address and payout destination of every photographer.
    // Now no policy admits another user's row, so the row is simply absent.
    const client = await signInAs(stranger.email);
    const { data, error } = await client
      .from('profiles')
      .select(`id, ${column}`)
      .eq('id', photographer.id);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('a signed-in stranger sees only their own row when listing profiles', async () => {
    const client = await signInAs(stranger.email);
    const { data } = await client.from('profiles').select('id');

    expect(data?.map((row) => row.id)).toEqual([stranger.id]);
  });

  it('a user can still read their own full profile', async () => {
    // Positive control. The settings pages read every column of the caller's own
    // row via `getProfile`'s `select('*')`.
    const client = await signInAs(photographer.email);
    const { data, error } = await client.from('profiles').select('*').eq('id', photographer.id);

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      full_name: 'Legal Name',
      address_line1: '221B Baker St',
      stripe_connect_account_id: 'acct_secret',
    });
  });
});

describe('public_profiles view — the public projection', () => {
  let photographer: { id: string; email: string; username: string };
  let talent: { id: string; email: string };

  beforeAll(async () => {
    await resetDatabase();
    photographer = await createTestUser('PHOTOGRAPHER');
    talent = await createTestUser('TALENT');
    await createServiceClient()
      .from('profiles')
      .update({ full_name: 'Legal Name', city: 'Madrid', country_code: 'ES' })
      .eq('id', photographer.id);
  });

  it('serves the public columns to anon', async () => {
    // The exact column list `getPhotographerBySlug` uses. If this breaks, the
    // public profile page 500s — so it is what keeps the view honest.
    const { data, error } = await createAnonClient()
      .from('public_profiles')
      .select(`${PUBLIC_COLUMNS}, created_at`)
      .eq('id', photographer.id);

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ username: photographer.username, city: 'Madrid' });
  });

  it('serves them to a signed-in stranger too', async () => {
    // `searchPhotographers` (the collaborator-invite dialog) is the one public
    // read that runs on the caller's own client rather than the service role.
    const client = await signInAs(talent.email);
    const { data, error } = await client
      .from('public_profiles')
      .select(PUBLIC_COLUMNS)
      .eq('active_role', 'PHOTOGRAPHER');

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it.each(SENSITIVE_COLUMNS)('does not expose %s', async (column) => {
    // ⚠️ The view runs with OWNER rights (no `security_invoker`), which is what
    // lets it project rows the self-only base policy hides. That makes its select
    // list the security boundary: a private column added to it would be world
    // readable with no policy left to catch it.
    const { error } = await createAnonClient().from('public_profiles').select(column);

    // PostgREST reports an unknown column rather than a privilege error — the
    // column genuinely is not part of the view.
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42703');
  });

  it('does not list talent profiles', async () => {
    // The view reproduces the dropped policy's `active_role = 'PHOTOGRAPHER'`
    // filter exactly, so this change widened nothing.
    const { data } = await createAnonClient().from('public_profiles').select('id');

    expect(data?.map((row) => row.id)).not.toContain(talent.id);
  });
});

describe('profiles RLS — the write surface', () => {
  let photographer: { id: string; email: string };

  beforeAll(async () => {
    await resetDatabase();
    photographer = await createTestUser('PHOTOGRAPHER');
    await createServiceClient()
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_real', stripe_connect_status: 'active' })
      .eq('id', photographer.id);
  });

  it('a user cannot rewrite their OWN stripe connect account id', async () => {
    // ⚠️ THE OTHER T-268 REGRESSION. This used to be a KNOWN GAP test asserting
    // the write SUCCEEDED: `profiles_self_update` restricts the row but not the
    // columns, so a photographer could repoint their own payout destination
    // straight through PostgREST, bypassing the Server Action entirely.
    const client = await signInAs(photographer.email);

    const { error } = await client
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_attacker_controlled' })
      .eq('id', photographer.id)
      .select();

    expect(error?.code).toBe('42501');
    const { data: after } = await createServiceClient()
      .from('profiles')
      .select('stripe_connect_account_id')
      .eq('id', photographer.id)
      .single();
    expect(after?.stripe_connect_account_id).toBe('acct_real');
  });

  it('a user cannot forge their own connect status to active', async () => {
    const client = await signInAs(photographer.email);
    const { error } = await client
      .from('profiles')
      .update({ stripe_connect_status: 'active' })
      .eq('id', photographer.id)
      .select();

    expect(error?.code).toBe('42501');
  });

  it('a user can still edit their own display name, bio and postal address', async () => {
    // Positive control for the column grant: the profile form and the payout
    // profile form both write through it.
    const client = await signInAs(photographer.email);

    const { data, error } = await client
      .from('profiles')
      .update({
        display_name: 'New Name',
        bio: 'New bio',
        address_line1: '10 Downing St',
        is_payout_profile_complete: true,
      })
      .eq('id', photographer.id)
      .select('display_name, address_line1');

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ display_name: 'New Name', address_line1: '10 Downing St' });
  });

  it('a user cannot update another user profile', async () => {
    const stranger = await createTestUser('TALENT');
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
