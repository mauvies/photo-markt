/**
 * Integration tests for `database/queries/orders.ts`.
 *
 * Orders are the contract between checkout and download access. Every query
 * here is exercised on the hot path after a Stripe webhook fires.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  addOrderItems,
  createOrder,
  getOrderByCheckoutSessionId,
  getOrderByPaymentIntentId,
  getPurchasedPhotoIdsForEvent,
  getTalentCompletedOrderCount,
  getUserOrders,
  updateOrderStatus,
} from '@/database/queries/orders';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function setupCommerce() {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(photographer.id);
  const photo = await createTestPhoto(event.id);
  const talent = await createTestUser('TALENT');
  return { photographer, event, photo, talent };
}

describe('database/queries/orders', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('createOrder', () => {
    it('defaults status to "pending" and currency to "usd"', async () => {
      const talent = await createTestUser('TALENT');
      const order = await createOrder(createServiceClient(), talent.id, {
        total_amount_cents: 500,
      });
      expect(order.user_id).toBe(talent.id);
      expect(order.status).toBe('pending');
      expect(order.currency).toBe('usd');
      expect(order.total_amount_cents).toBe(500);
    });

    it('persists the supplied stripe identifiers', async () => {
      const talent = await createTestUser('TALENT');
      const order = await createOrder(createServiceClient(), talent.id, {
        total_amount_cents: 1500,
        stripe_payment_intent_id: 'pi_abc',
        stripe_checkout_session_id: 'cs_xyz',
        status: 'completed',
      });
      expect(order.stripe_payment_intent_id).toBe('pi_abc');
      expect(order.stripe_checkout_session_id).toBe('cs_xyz');
      expect(order.status).toBe('completed');
    });
  });

  describe('addOrderItems', () => {
    it('computes total_price_cents from unit × quantity', async () => {
      const { photographer, photo, talent } = await setupCommerce();
      const sb = createServiceClient();
      const order = await createOrder(sb, talent.id, { total_amount_cents: 0 });

      const items = await addOrderItems(sb, order.id, [
        {
          photo_id: photo.id,
          photographer_id: photographer.id,
          unit_price_cents: 300,
          quantity: 2,
        },
      ]);

      expect(items).toHaveLength(1);
      expect(items[0].total_price_cents).toBe(600);
      expect(items[0].quantity).toBe(2);
    });

    it('defaults quantity to 1 when omitted', async () => {
      const { photographer, photo, talent } = await setupCommerce();
      const sb = createServiceClient();
      const order = await createOrder(sb, talent.id, { total_amount_cents: 0 });

      const items = await addOrderItems(sb, order.id, [
        { photo_id: photo.id, photographer_id: photographer.id, unit_price_cents: 750 },
      ]);

      expect(items[0].quantity).toBe(1);
      expect(items[0].total_price_cents).toBe(750);
    });
  });

  describe('getOrderByPaymentIntentId', () => {
    it('finds the order matching the PI', async () => {
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      const created = await createOrder(sb, talent.id, {
        total_amount_cents: 100,
        stripe_payment_intent_id: 'pi_lookup',
      });
      const found = await getOrderByPaymentIntentId(sb, 'pi_lookup');
      expect(found?.id).toBe(created.id);
    });

    it('returns null when no order has the given PI', async () => {
      const found = await getOrderByPaymentIntentId(createServiceClient(), 'pi_nope');
      expect(found).toBeNull();
    });
  });

  describe('getOrderByCheckoutSessionId', () => {
    it('finds the order matching the checkout session', async () => {
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      const created = await createOrder(sb, talent.id, {
        total_amount_cents: 100,
        stripe_checkout_session_id: 'cs_lookup',
      });
      const found = await getOrderByCheckoutSessionId(sb, 'cs_lookup');
      expect(found?.id).toBe(created.id);
    });

    it('returns null on miss', async () => {
      expect(await getOrderByCheckoutSessionId(createServiceClient(), 'cs_nope')).toBeNull();
    });
  });

  describe('updateOrderStatus', () => {
    it('flips the order status', async () => {
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      const order = await createOrder(sb, talent.id, { total_amount_cents: 100 });
      await updateOrderStatus(sb, order.id, 'completed');

      const after = await getOrderByPaymentIntentId(sb, '');
      // We don't have a PI to look it up; re-read directly.
      const { data } = await sb.from('orders').select('status').eq('id', order.id).single();
      expect(data?.status).toBe('completed');
      expect(after).toBeNull(); // empty PI matches nothing
    });
  });

  describe('getUserOrders', () => {
    it("returns only the requesting user's orders", async () => {
      const a = await createTestUser('TALENT');
      const b = await createTestUser('TALENT');
      const sb = createServiceClient();
      await createOrder(sb, a.id, { total_amount_cents: 100 });
      await createOrder(sb, a.id, { total_amount_cents: 200 });
      await createOrder(sb, b.id, { total_amount_cents: 300 });

      const orders = await getUserOrders(sb, a.id, 100);
      expect(orders).toHaveLength(2);
      for (const o of orders) expect(o.user_id).toBe(a.id);
    });

    it('caps the result at the supplied limit', async () => {
      const t = await createTestUser('TALENT');
      const sb = createServiceClient();
      for (let i = 0; i < 5; i++) {
        await createOrder(sb, t.id, { total_amount_cents: i * 100 });
      }
      const orders = await getUserOrders(sb, t.id, 3);
      expect(orders).toHaveLength(3);
    });
  });

  // Backs the talent profile "purchases" stat (T-143) — counts COMPLETED orders
  // only, and scoped to the requesting user.
  describe('getTalentCompletedOrderCount', () => {
    it('counts only the user’s completed orders (ignores pending/failed and other users)', async () => {
      const talent = await createTestUser('TALENT');
      const other = await createTestUser('TALENT');
      const sb = createServiceClient();
      await createOrder(sb, talent.id, { total_amount_cents: 100, status: 'completed' });
      await createOrder(sb, talent.id, { total_amount_cents: 200, status: 'completed' });
      await createOrder(sb, talent.id, { total_amount_cents: 300, status: 'pending' });
      await createOrder(sb, talent.id, { total_amount_cents: 400, status: 'failed' });
      // A different user's completed order must not leak into the count.
      await createOrder(sb, other.id, { total_amount_cents: 500, status: 'completed' });

      expect(await getTalentCompletedOrderCount(sb, talent.id)).toBe(2);
    });

    it('returns 0 for a user with no completed orders', async () => {
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      await createOrder(sb, talent.id, { total_amount_cents: 100, status: 'pending' });
      expect(await getTalentCompletedOrderCount(sb, talent.id)).toBe(0);
    });
  });

  // This query is the authoritative paid-event permission check behind the
  // bulk-download API route — a regression here would leak unpurchased photos.
  describe('getPurchasedPhotoIdsForEvent', () => {
    it('returns photo ids the user purchased in completed orders for the event', async () => {
      const { photographer, event, photo, talent } = await setupCommerce();
      const sb = createServiceClient();
      const order = await createOrder(sb, talent.id, {
        total_amount_cents: 300,
        status: 'completed',
      });
      await addOrderItems(sb, order.id, [
        { photo_id: photo.id, photographer_id: photographer.id, unit_price_cents: 300 },
      ]);

      const purchased = await getPurchasedPhotoIdsForEvent(sb, talent.id, event.id);
      expect(purchased.has(photo.id)).toBe(true);
      expect(purchased.size).toBe(1);
    });

    it('excludes photos from non-completed orders', async () => {
      const { photographer, event, photo, talent } = await setupCommerce();
      const sb = createServiceClient();
      const order = await createOrder(sb, talent.id, {
        total_amount_cents: 300,
        status: 'pending',
      });
      await addOrderItems(sb, order.id, [
        { photo_id: photo.id, photographer_id: photographer.id, unit_price_cents: 300 },
      ]);

      const purchased = await getPurchasedPhotoIdsForEvent(sb, talent.id, event.id);
      expect(purchased.size).toBe(0);
    });

    it("excludes another user's purchases", async () => {
      const { photographer, event, photo, talent } = await setupCommerce();
      const other = await createTestUser('TALENT');
      const sb = createServiceClient();
      const order = await createOrder(sb, other.id, {
        total_amount_cents: 300,
        status: 'completed',
      });
      await addOrderItems(sb, order.id, [
        { photo_id: photo.id, photographer_id: photographer.id, unit_price_cents: 300 },
      ]);

      const purchased = await getPurchasedPhotoIdsForEvent(sb, talent.id, event.id);
      expect(purchased.size).toBe(0);
    });

    it('excludes purchased photos that belong to a different event', async () => {
      const { photographer, photo, talent } = await setupCommerce();
      const otherEvent = await createTestEvent(photographer.id);
      const sb = createServiceClient();
      const order = await createOrder(sb, talent.id, {
        total_amount_cents: 300,
        status: 'completed',
      });
      await addOrderItems(sb, order.id, [
        { photo_id: photo.id, photographer_id: photographer.id, unit_price_cents: 300 },
      ]);

      // `photo` belongs to `event`, so scoping to `otherEvent` must return nothing.
      const purchased = await getPurchasedPhotoIdsForEvent(sb, talent.id, otherEvent.id);
      expect(purchased.size).toBe(0);
    });
  });
});
