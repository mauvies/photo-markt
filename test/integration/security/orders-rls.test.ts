/**
 * Regression tests for finding H1 from the May 2026 security audit.
 *
 * The audit showed that `orders` and `order_items` had RLS policies that
 * let authenticated users INSERT (orders, with `auth.uid() = user_id`) and
 * INSERT/UPDATE (order_items, with `using/with check (true)`) directly via
 * PostgREST. Combined with the public photo SELECT policy in place at the
 * time, that meant a user could fabricate a "completed" order pointing at
 * any photo and call `getPhotoDownloadUrl` to get a signed URL.
 *
 * The fix dropped those three policies. Orders/order_items are now written
 * exclusively by the Stripe webhook via the service-role client.
 *
 * Each test below pins one of the closed holes; together they ensure the
 * fake-purchase exploit can't be reintroduced by a careless `using (true)`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

describe('orders/order_items RLS — H1 regression', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('blocks authenticated user from inserting a fake completed order', async () => {
    const alice = await createTestUser('TALENT');
    const aliceClient = await signInAs(alice.email);

    const { error } = await aliceClient.from('orders').insert({
      user_id: alice.id,
      status: 'completed',
      total_amount_cents: 0,
    });

    // Postgres surfaces RLS denials with code 42501. Whichever variant the
    // client returns, the row must not exist after the call.
    expect(error?.code).toBe('42501');
    const { count } = await createServiceClient()
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', alice.id);
    expect(count).toBe(0);
  });

  it('blocks authenticated user from updating an order (even their own)', async () => {
    // Seed an order owned by Alice via service-role (simulating what the
    // Stripe webhook would do).
    const alice = await createTestUser('TALENT');
    const sb = createServiceClient();
    const { data: seeded } = await sb
      .from('orders')
      .insert({ user_id: alice.id, status: 'pending', total_amount_cents: 100 })
      .select('id')
      .single();
    if (!seeded) throw new Error('seed failed');

    const aliceClient = await signInAs(alice.email);
    const { data, error } = await aliceClient
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', seeded.id)
      .select();

    // Either an explicit RLS error or zero rows touched — but the canonical
    // assertion is that the status stays put.
    if (error) {
      expect(error.code).toBe('42501');
    } else {
      expect(data).toEqual([]);
    }
    const { data: after } = await sb.from('orders').select('status').eq('id', seeded.id).single();
    expect(after?.status).toBe('pending');
  });

  it('blocks authenticated user from inserting an order_item directly', async () => {
    // Set up a photographer + photo so the FK constraint isn't what trips
    // the test — we want to see the RLS denial specifically.
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);
    const alice = await createTestUser('TALENT');

    // Seed an empty order owned by Alice via service-role so the FK target
    // exists. The interesting question is whether Alice can add an item.
    const sb = createServiceClient();
    const { data: order } = await sb
      .from('orders')
      .insert({ user_id: alice.id, status: 'pending', total_amount_cents: 0 })
      .select('id')
      .single();
    if (!order) throw new Error('seed failed');

    const aliceClient = await signInAs(alice.email);
    const { error } = await aliceClient.from('order_items').insert({
      order_id: order.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 0,
      total_price_cents: 0,
    });

    expect(error?.code).toBe('42501');
    const { count } = await sb
      .from('order_items')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', order.id);
    expect(count).toBe(0);
  });

  it('service role can still INSERT orders + order_items (webhook path)', async () => {
    // The webhook handler is the one legitimate path that writes here.
    // It uses supabaseAdmin and must continue to work.
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);
    const alice = await createTestUser('TALENT');
    const sb = createServiceClient();

    const { data: order, error: orderErr } = await sb
      .from('orders')
      .insert({ user_id: alice.id, status: 'completed', total_amount_cents: 500 })
      .select('id')
      .single();
    expect(orderErr).toBeNull();
    expect(order?.id).toBeDefined();

    const { error: itemErr } = await sb.from('order_items').insert({
      order_id: order!.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 500,
      total_price_cents: 500,
    });
    expect(itemErr).toBeNull();
  });
});
