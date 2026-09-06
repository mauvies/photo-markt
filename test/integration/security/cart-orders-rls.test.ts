/**
 * RLS for the buying path (T-227): `carts`, `cart_items`, `order_items`.
 *
 * `orders` itself is already covered by `orders-rls.test.ts` (the H1 regression);
 * this file adds the three tables around it, all of which use the ONE-HOP
 * ownership shape — the row carries no `user_id`, so the policy reaches through
 * a parent (`carts.user_id`, `orders.user_id`).
 *
 * That shape is worth testing precisely because it is indirect: a policy that
 * checked only `cart_items.photographer_id` would look plausible and would let any
 * photographer read the carts their photos sit in, including which buyer is about
 * to purchase what.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAnonClient,
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

/** A cart owned by `userId` holding one photo sold by `photographerId`. */
async function seedCartWithItem(userId: string, photographerId: string, photoId: string) {
  const sb = createServiceClient();
  const { data: cart, error: cartError } = await sb
    .from('carts')
    .insert({ user_id: userId })
    .select('id')
    .single();
  if (cartError || !cart) throw new Error(`cart seed failed: ${cartError?.message}`);

  const { data: item, error: itemError } = await sb
    .from('cart_items')
    .insert({
      cart_id: cart.id,
      photo_id: photoId,
      photographer_id: photographerId,
      unit_price_cents: 500,
    })
    .select('id')
    .single();
  if (itemError || !item) throw new Error(`cart item seed failed: ${itemError?.message}`);

  return { cartId: cart.id as string, itemId: item.id as string };
}

async function seedOrderWithItem(userId: string, photographerId: string, photoId: string) {
  const sb = createServiceClient();
  const { data: order, error: orderError } = await sb
    .from('orders')
    .insert({ user_id: userId, total_amount_cents: 500, status: 'completed' })
    .select('id')
    .single();
  if (orderError || !order) throw new Error(`order seed failed: ${orderError?.message}`);

  const { data: item, error: itemError } = await sb
    .from('order_items')
    .insert({
      order_id: order.id,
      photo_id: photoId,
      photographer_id: photographerId,
      unit_price_cents: 500,
      total_price_cents: 500,
    })
    .select('id')
    .single();
  if (itemError || !item) throw new Error(`order item seed failed: ${itemError?.message}`);

  return { orderId: order.id as string, itemId: item.id as string };
}

describe('carts / cart_items RLS', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('another buyer cannot read your cart or the items in it', async () => {
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    await seedCartWithItem(buyer.id, photographer.id, photo.id);
    const stranger = await createTestUser('TALENT');
    const strangerClient = await signInAs(stranger.email);

    const { data: carts } = await strangerClient.from('carts').select('*');
    const { data: items } = await strangerClient.from('cart_items').select('*');

    expect(carts ?? []).toEqual([]);
    expect(items ?? []).toEqual([]);
  });

  it('anon cannot read carts or cart items', async () => {
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    await seedCartWithItem(buyer.id, photographer.id, photo.id);

    const anon = createAnonClient();
    const { data: carts } = await anon.from('carts').select('id');
    const { data: items } = await anon.from('cart_items').select('id');

    expect(carts ?? []).toEqual([]);
    expect(items ?? []).toEqual([]);
  });

  it('a stranger cannot add an item to your cart', async () => {
    // The one-hop WITH CHECK: `EXISTS(carts WHERE id = cart_id AND user_id = auth.uid())`.
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const { cartId } = await seedCartWithItem(buyer.id, photographer.id, photo.id);
    const stranger = await createTestUser('TALENT');

    const { error } = await (await signInAs(stranger.email))
      .from('cart_items')
      .insert({
        cart_id: cartId,
        photo_id: photo.id,
        photographer_id: photographer.id,
        unit_price_cents: 1,
      })
      .select();

    expect(error?.code).toBe('42501');
    const { count } = await createServiceClient()
      .from('cart_items')
      .select('*', { count: 'exact', head: true })
      .eq('cart_id', cartId);
    expect(count).toBe(1);
  });

  it('a stranger cannot delete items from your cart, nor reprice them', async () => {
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const { itemId } = await seedCartWithItem(buyer.id, photographer.id, photo.id);
    const stranger = await createTestUser('TALENT');
    const strangerClient = await signInAs(stranger.email);

    await strangerClient.from('cart_items').delete().eq('id', itemId);
    // Repricing someone else's cart item is the sharper one: the authenticated
    // checkout re-reads these rows to build the Stripe session.
    await strangerClient.from('cart_items').update({ unit_price_cents: 1 }).eq('id', itemId);

    const { data: after } = await createServiceClient()
      .from('cart_items')
      .select('unit_price_cents')
      .eq('id', itemId)
      .maybeSingle();
    expect(after?.unit_price_cents).toBe(500);
  });

  it('the photographer can see their photo sitting in a cart, but not the cart', async () => {
    // `Photographers can view sales of their photos` is scoped to `cart_items`
    // only — deliberately, since the cart row identifies the buyer.
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    await seedCartWithItem(buyer.id, photographer.id, photo.id);
    const photographerClient = await signInAs(photographer.email);

    const { data: items } = await photographerClient.from('cart_items').select('id');
    const { data: carts } = await photographerClient.from('carts').select('id');

    expect(items).toHaveLength(1);
    expect(carts ?? []).toEqual([]);
  });

  it('the buyer can still read and clear their own cart', async () => {
    // Positive control.
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const { itemId } = await seedCartWithItem(buyer.id, photographer.id, photo.id);
    const buyerClient = await signInAs(buyer.email);

    const { data: items } = await buyerClient.from('cart_items').select('id');
    expect(items).toHaveLength(1);

    const { data: deleted } = await buyerClient
      .from('cart_items')
      .delete()
      .eq('id', itemId)
      .select();
    expect(deleted).toHaveLength(1);
  });
});

describe('order_items RLS', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('another buyer cannot read your order items', async () => {
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    await seedOrderWithItem(buyer.id, photographer.id, photo.id);
    const stranger = await createTestUser('TALENT');

    const { data } = await (await signInAs(stranger.email)).from('order_items').select('*');

    // Entitlement lives here: order_items is what the download route reads to
    // decide who may fetch a full-resolution original.
    expect(data ?? []).toEqual([]);
  });

  it('anon cannot read order items', async () => {
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    await seedOrderWithItem(buyer.id, photographer.id, photo.id);

    const { data } = await createAnonClient().from('order_items').select('id');
    expect(data ?? []).toEqual([]);
  });

  it('the buyer and the photographer can each read the row, from opposite sides', async () => {
    // Positive control for BOTH SELECT policies: one hop through orders.user_id
    // for the buyer, direct photographer_id for the seller.
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    await seedOrderWithItem(buyer.id, photographer.id, photo.id);

    const { data: asBuyer } = await (await signInAs(buyer.email)).from('order_items').select('id');
    const { data: asSeller } = await (await signInAs(photographer.email))
      .from('order_items')
      .select('id');

    expect(asBuyer).toHaveLength(1);
    expect(asSeller).toHaveLength(1);
  });

  it('nobody can forge an order item — there is no INSERT policy', async () => {
    // A forged row grants a download entitlement for a photo nobody paid for.
    const buyer = await createTestUser('TALENT');
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const { orderId } = await seedOrderWithItem(buyer.id, photographer.id, photo.id);

    const { error } = await (await signInAs(buyer.email))
      .from('order_items')
      .insert({
        order_id: orderId,
        photo_id: photo.id,
        photographer_id: photographer.id,
        unit_price_cents: 0,
        total_price_cents: 0,
      })
      .select();

    expect(error?.code).toBe('42501');
  });
});
