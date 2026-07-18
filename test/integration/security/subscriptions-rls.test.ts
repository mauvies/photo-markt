/**
 * Security regression for T-148: `subscriptions` is a system-managed table.
 *
 * RLS is enabled with **no policies** for the `anon`/`authenticated` roles
 * (verified in prod), so it is service-role-only — exactly like `admin_users`
 * and `rate_limit_buckets`. The billing actions therefore MUST read/insert
 * subscriptions through `supabaseAdmin`; the previous user-scoped insert failed
 * with 42501, which is what broke every paid checkout.
 *
 * These tests pin that invariant. If someone ever "fixes" checkout by adding a
 * permissive `authenticated` policy instead of using the service-role client,
 * the first two assertions flip and this suite fails loudly.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

describe('subscriptions RLS — service-role-only invariant (T-148)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('denies an authenticated (user-scoped) client from inserting a subscription (42501)', async () => {
    const alice = await createTestUser('PHOTOGRAPHER');
    const aliceClient = await signInAs(alice.email);

    const { error } = await aliceClient.from('subscriptions').insert({
      user_id: alice.id,
      stripe_customer_id: 'cus_user_scoped',
      plan_id: 'starter',
      status: 'incomplete',
    });

    // The RLS write is denied — this is the 42501 the old billing action hit.
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');

    // Nothing was written.
    const { data } = await createServiceClient()
      .from('subscriptions')
      .select('id')
      .eq('user_id', alice.id);
    expect(data).toEqual([]);
  });

  it('hides existing subscription rows from the user-scoped client (select returns nothing)', async () => {
    const alice = await createTestUser('PHOTOGRAPHER');
    // Seed a real row via the service-role client (the webhook/admin path).
    const admin = createServiceClient();
    const { error: seedError } = await admin.from('subscriptions').insert({
      user_id: alice.id,
      stripe_customer_id: 'cus_admin_seeded',
      stripe_subscription_id: 'sub_admin_seeded',
      plan_id: 'pro',
      status: 'active',
    });
    expect(seedError).toBeNull();

    // The user-scoped client can't see it → the old user-scoped `getSubscription`
    // silently returned null, so it always created a duplicate customer.
    const aliceClient = await signInAs(alice.email);
    const { data, error } = await aliceClient
      .from('subscriptions')
      .select('id, plan_id')
      .eq('user_id', alice.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('allows the service-role client to read and write subscriptions (the billing/webhook path)', async () => {
    const alice = await createTestUser('PHOTOGRAPHER');
    const admin = createServiceClient();

    const { error: insertError } = await admin.from('subscriptions').insert({
      user_id: alice.id,
      stripe_customer_id: 'cus_admin',
      plan_id: 'starter',
      status: 'incomplete',
    });
    expect(insertError).toBeNull();

    const { data } = await admin
      .from('subscriptions')
      .select('plan_id, status')
      .eq('user_id', alice.id)
      .single();
    expect(data?.plan_id).toBe('starter');
    expect(data?.status).toBe('incomplete');
  });
});
