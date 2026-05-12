/**
 * Regression tests for finding C2 from the May 2026 security audit:
 * "payouts UPDATE policy uses `USING (true) WITH CHECK (true)`" — any
 * authenticated user could PATCH any payout via PostgREST.
 *
 * The fix replaced the permissive policy with:
 *   for update
 *   using (auth.uid() = photographer_id and status = 'pending')
 *   with check (auth.uid() = photographer_id and status in ('pending', 'cancelled'))
 *
 * Each test pins one property of that policy. If any of them ever loosens,
 * a real exploit is back; this suite fails loudly first.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

async function createPendingPayout(photographerId: string, amountCents = 1500) {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('payouts')
    .insert({ photographer_id: photographerId, amount_cents: amountCents, status: 'pending' })
    .select('id, photographer_id, status, amount_cents')
    .single();
  if (error || !data) throw new Error(`payout insert: ${error?.message}`);
  return data;
}

async function readPayout(id: string) {
  const { data } = await createServiceClient()
    .from('payouts')
    .select('status, amount_cents')
    .eq('id', id)
    .single();
  return data;
}

describe('payouts RLS — C2 regression', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks photographer A from updating photographer B's payout", async () => {
    const alice = await createTestUser('PHOTOGRAPHER');
    const bob = await createTestUser('PHOTOGRAPHER');
    const bobsPayout = await createPendingPayout(bob.id);

    const aliceClient = await signInAs(alice.email);
    const { data, error } = await aliceClient
      .from('payouts')
      .update({ status: 'paid' })
      .eq('id', bobsPayout.id)
      .select();

    // PostgREST silently returns an empty array when RLS filters everything
    // out — no error, just zero rows touched. That's the shape we want to
    // assert: the request succeeded HTTP-wise but did nothing.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // And the row in the DB is still pending — the canonical assertion.
    const after = await readPayout(bobsPayout.id);
    expect(after?.status).toBe('pending');
  });

  it('allows photographer to cancel their own pending payout', async () => {
    const alice = await createTestUser('PHOTOGRAPHER');
    const payout = await createPendingPayout(alice.id);

    const aliceClient = await signInAs(alice.email);
    const { data, error } = await aliceClient
      .from('payouts')
      .update({ status: 'cancelled' })
      .eq('id', payout.id)
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe('cancelled');
  });

  it('blocks photographer from flipping their own pending payout to paid', async () => {
    // 'paid' is not in the WITH CHECK allowlist; only photographers in
    // (pending, cancelled) transitions are permitted. Approval/payment is
    // an admin-only path that goes via the service-role client.
    const alice = await createTestUser('PHOTOGRAPHER');
    const payout = await createPendingPayout(alice.id);

    const aliceClient = await signInAs(alice.email);
    const { data, error } = await aliceClient
      .from('payouts')
      .update({ status: 'paid' })
      .eq('id', payout.id)
      .select();

    // PostgREST surfaces a 42501 (RLS violation) on a WITH CHECK failure.
    // We accept either the explicit error OR an empty data array — Supabase
    // versions have varied; what matters is the row stays untouched.
    if (error) {
      expect(error.code).toBe('42501');
    } else {
      expect(data).toEqual([]);
    }
    const after = await readPayout(payout.id);
    expect(after?.status).toBe('pending');
  });

  it('blocks photographer from updating their own non-pending payout (USING filter)', async () => {
    // The USING clause requires `status = 'pending'`, so a payout already
    // in 'paid' state is invisible to the photographer for UPDATE. They
    // can't reopen it or change anything.
    const alice = await createTestUser('PHOTOGRAPHER');
    const sb = createServiceClient();
    const { data: paidPayout } = await sb
      .from('payouts')
      .insert({ photographer_id: alice.id, amount_cents: 2000, status: 'paid' })
      .select('id')
      .single();
    if (!paidPayout) throw new Error('seed failed');

    const aliceClient = await signInAs(alice.email);
    const { data, error } = await aliceClient
      .from('payouts')
      .update({ status: 'cancelled' })
      .eq('id', paidPayout.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
    const after = await readPayout(paidPayout.id);
    expect(after?.status).toBe('paid');
  });

  it('service role bypasses RLS and can mark any payout as paid', async () => {
    // The Stripe webhook path uses service-role and must continue to work
    // regardless of the user-facing policy.
    const alice = await createTestUser('PHOTOGRAPHER');
    const payout = await createPendingPayout(alice.id);

    const { data, error } = await createServiceClient()
      .from('payouts')
      .update({ status: 'paid' })
      .eq('id', payout.id)
      .select();

    expect(error).toBeNull();
    expect(data?.[0]?.status).toBe('paid');
  });
});
