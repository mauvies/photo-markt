/**
 * RLS posture of `payouts` — photographer-read, service-role-write.
 *
 * ## History, because the posture inverted
 *
 * The May 2026 audit (finding C2) found the UPDATE policy was
 * `using (true) with check (true)`, so any authenticated user could PATCH any
 * payout. The fix narrowed it to "a photographer may cancel their OWN pending
 * payout", and left the original "photographers can create their own payouts"
 * INSERT policy in place. Both were tolerable only because `pending` was inert:
 * every payout was written straight to `paid` by the Stripe webhook, and nothing
 * anywhere acted on a `pending` row.
 *
 * T-216 changed exactly that. `pending` now means "a background worker will
 * really send this money", which turns both policies into money paths:
 *
 *   - **INSERT** would be self-service theft — mint your own `pending` row and
 *     wait for the retry worker to wire the funds.
 *   - **UPDATE** (pending → cancelled) would let a photographer void a hold, and
 *     the `(stripe_charge_id, photographer_id)` unique index then blocks ever
 *     creating a replacement row for that charge. Their own money, unpayable
 *     forever, by their own click.
 *
 * So both were dropped in `20260807000000_add_payout_ledger.sql`. Nothing
 * user-facing regressed: `createPayout` has no caller in `src/`. Each test below
 * pins one half of the new posture; if any of them loosens, a real exploit is
 * back and this suite fails first.
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

describe('payouts RLS — writes are service-role only', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('blocks a photographer from inserting a payout for themselves', async () => {
    // The T-216 regression. A row inserted here would be picked up by the retry
    // worker and paid for real.
    const alice = await createTestUser('PHOTOGRAPHER');
    const aliceClient = await signInAs(alice.email);

    const { data, error } = await aliceClient
      .from('payouts')
      .insert({ photographer_id: alice.id, amount_cents: 500_00, status: 'pending' })
      .select();

    // PostgREST surfaces a 42501 when no INSERT policy admits the row.
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();

    const { count } = await createServiceClient()
      .from('payouts')
      .select('*', { count: 'exact', head: true })
      .eq('photographer_id', alice.id);
    expect(count).toBe(0);
  });

  it('blocks a photographer from inserting a payout for someone else', async () => {
    const alice = await createTestUser('PHOTOGRAPHER');
    const bob = await createTestUser('PHOTOGRAPHER');
    const aliceClient = await signInAs(alice.email);

    const { error } = await aliceClient
      .from('payouts')
      .insert({ photographer_id: bob.id, amount_cents: 500_00, status: 'pending' })
      .select();

    expect(error?.code).toBe('42501');
  });

  it('blocks a photographer from cancelling their own pending payout', async () => {
    // This WAS allowed before T-216. It is not any more: cancelling a hold makes
    // it permanently unpayable, because the (charge, photographer) unique index
    // then rejects a replacement row.
    const alice = await createTestUser('PHOTOGRAPHER');
    const payout = await createPendingPayout(alice.id);

    const aliceClient = await signInAs(alice.email);
    const { data, error } = await aliceClient
      .from('payouts')
      .update({ status: 'cancelled' })
      .eq('id', payout.id)
      .select();

    // With no UPDATE policy at all, RLS filters the row out: the request
    // succeeds HTTP-wise and touches nothing.
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await readPayout(payout.id))?.status).toBe('pending');
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

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await readPayout(bobsPayout.id))?.status).toBe('pending');
  });

  it('blocks a photographer from flipping their own payout to paid', async () => {
    // The most direct attack: mark yourself paid, or mark yourself owed.
    const alice = await createTestUser('PHOTOGRAPHER');
    const payout = await createPendingPayout(alice.id);

    const aliceClient = await signInAs(alice.email);
    const { data, error } = await aliceClient
      .from('payouts')
      .update({ status: 'paid' })
      .eq('id', payout.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await readPayout(payout.id))?.status).toBe('pending');
  });

  it('blocks a photographer from inflating their own payout amount', async () => {
    const alice = await createTestUser('PHOTOGRAPHER');
    const payout = await createPendingPayout(alice.id, 100);

    const aliceClient = await signInAs(alice.email);
    await aliceClient
      .from('payouts')
      .update({ amount_cents: 100_000 })
      .eq('id', payout.id)
      .select();

    expect((await readPayout(payout.id))?.amount_cents).toBe(100);
  });

  it('blocks a photographer from deleting a payout', async () => {
    const alice = await createTestUser('PHOTOGRAPHER');
    const payout = await createPendingPayout(alice.id);

    const aliceClient = await signInAs(alice.email);
    await aliceClient.from('payouts').delete().eq('id', payout.id);

    expect(await readPayout(payout.id)).not.toBeNull();
  });

  it('still lets a photographer read their own payouts', async () => {
    // The SELECT policy is deliberately kept — the earnings tab renders these,
    // and keeping it also stops the table tripping the `rls_enabled_no_policy`
    // advisor.
    const alice = await createTestUser('PHOTOGRAPHER');
    const payout = await createPendingPayout(alice.id, 2500);

    const aliceClient = await signInAs(alice.email);
    const { data, error } = await aliceClient.from('payouts').select('id, amount_cents');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(payout.id);
    expect(data?.[0]?.amount_cents).toBe(2500);
  });

  it("does not let a photographer read someone else's payouts", async () => {
    const alice = await createTestUser('PHOTOGRAPHER');
    const bob = await createTestUser('PHOTOGRAPHER');
    await createPendingPayout(bob.id);

    const aliceClient = await signInAs(alice.email);
    const { data } = await aliceClient.from('payouts').select('id');

    expect(data).toEqual([]);
  });

  it('service role bypasses RLS and can settle a payout', async () => {
    // The Stripe webhook and the retry worker are the only writers, and both
    // must keep working after the lockdown.
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
