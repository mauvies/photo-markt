/**
 * Regression tests for T-144: guest (unauthenticated) sales must appear in the
 * photographer Sales dashboard, not just under Earnings.
 *
 * Guest checkout writes `guest_orders` + `guest_order_items` (+ `payouts`) and
 * never touches `order_items`. Before the fix the Sales queries read only
 * `order_items`, so a guest sale showed up under Earnings-summary (which reads
 * `payouts`) but the Sales tab stayed empty. These tests seed a guest sale and
 * assert every sales/earnings surface counts it, and that Sales and Earnings
 * gross totals agree.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getPhotographerEarnings, getTotalGrossEarnings } from '@/database/queries/earnings';
import {
  getRecentSales,
  getSalesOverTime,
  getSalesSummary,
  getTopSellingEvents,
} from '@/database/queries/sales';
import type { SupabaseServerClient } from '@/database/queries/types';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** Seed a completed AUTHENTICATED purchase of `photoId` by `buyerId`. */
async function seedAuthedSale(
  buyerId: string,
  photographerId: string,
  photoId: string,
  priceCents: number,
  itemCreatedAt?: string,
) {
  const sb = createServiceClient();
  const { data: order, error } = await sb
    .from('orders')
    .insert({ user_id: buyerId, status: 'completed', total_amount_cents: priceCents })
    .select('id')
    .single();
  if (error || !order) throw new Error(`seedAuthedSale order: ${error?.message}`);
  const { error: itemError } = await sb.from('order_items').insert({
    order_id: order.id,
    photo_id: photoId,
    photographer_id: photographerId,
    unit_price_cents: priceCents,
    total_price_cents: priceCents,
    ...(itemCreatedAt ? { created_at: itemCreatedAt } : {}),
  });
  if (itemError) throw new Error(`seedAuthedSale item: ${itemError.message}`);
}

/** Seed a completed GUEST purchase of `photoId` (+ matching payout row). */
async function seedGuestSale(
  guestEmail: string,
  photographerId: string,
  photoId: string,
  priceCents: number,
  itemCreatedAt?: string,
) {
  const sb = createServiceClient();
  const { data: order, error } = await sb
    .from('guest_orders')
    .insert({
      guest_email: guestEmail,
      stripe_checkout_session_id: `cs_test_${crypto.randomUUID()}`,
      status: 'completed',
      total_amount_cents: priceCents,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !order) throw new Error(`seedGuestSale order: ${error?.message}`);
  const { error: itemError } = await sb.from('guest_order_items').insert({
    guest_order_id: order.id,
    photo_id: photoId,
    photographer_id: photographerId,
    unit_price_cents: priceCents,
    quantity: 1,
    total_price_cents: priceCents,
    ...(itemCreatedAt ? { created_at: itemCreatedAt } : {}),
  });
  if (itemError) throw new Error(`seedGuestSale item: ${itemError.message}`);
  // Payout mirrors the per-order transfer written by the webhook.
  const { error: payoutError } = await sb.from('payouts').insert({
    photographer_id: photographerId,
    amount_cents: priceCents,
    status: 'paid',
    stripe_transfer_id: `tr_test_${crypto.randomUUID()}`,
    paid_at: new Date().toISOString(),
  });
  if (payoutError) throw new Error(`seedGuestSale payout: ${payoutError.message}`);
}

describe('T-144 — guest sales visibility in the sales dashboard', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('a guest-only sale appears in getSalesSummary / getRecentSales (before fix: empty)', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 7 });
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });

    await seedGuestSale('guest@example.com', photographer.id, photo.id, 700);

    const summary = await getSalesSummary(sb, photographer.id);
    expect(summary.totalSales).toBe(1);
    expect(summary.totalRevenueCents).toBe(700);
    expect(summary.totalPhotosSold).toBe(1);

    const recent = await getRecentSales(sb, photographer.id);
    expect(recent).toHaveLength(1);
    expect(recent[0].photo_id).toBe(photo.id);
    // Guest buyer email resolves from guest_orders, not the auth RPC.
    expect(recent[0].buyer_email).toBe('guest@example.com');
  });

  it('counts authenticated AND guest sales together across every surface', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const authedPhoto = await createTestPhoto(event.id, { user_id: photographer.id });
    const guestPhoto = await createTestPhoto(event.id, { user_id: photographer.id });

    await seedAuthedSale(buyer.id, photographer.id, authedPhoto.id, 500);
    await seedGuestSale('guest@example.com', photographer.id, guestPhoto.id, 900);

    const summary = await getSalesSummary(sb, photographer.id);
    expect(summary.totalSales).toBe(2); // two distinct orders
    expect(summary.totalRevenueCents).toBe(1400);
    expect(summary.totalPhotosSold).toBe(2);

    const recent = await getRecentSales(sb, photographer.id);
    expect(recent.map((s) => s.photo_id).sort()).toEqual([authedPhoto.id, guestPhoto.id].sort());

    const overTime = await getSalesOverTime(sb, photographer.id);
    const totalRevenue = overTime.reduce((sum, row) => sum + row.revenue_cents, 0);
    const totalCount = overTime.reduce((sum, row) => sum + row.sales_count, 0);
    expect(totalRevenue).toBe(1400);
    expect(totalCount).toBe(2);

    const topEvents = await getTopSellingEvents(sb, photographer.id);
    expect(topEvents).toHaveLength(1);
    expect(topEvents[0].event_id).toBe(event.id);
    expect(topEvents[0].revenue_cents).toBe(1400);
    expect(topEvents[0].photos_sold).toBe(2);
  });

  it('Sales revenue and Earnings gross totals agree (both count guest sales)', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const authedPhoto = await createTestPhoto(event.id, { user_id: photographer.id });
    const guestPhoto = await createTestPhoto(event.id, { user_id: photographer.id });

    await seedAuthedSale(buyer.id, photographer.id, authedPhoto.id, 500);
    await seedGuestSale('guest@example.com', photographer.id, guestPhoto.id, 900);

    const summary = await getSalesSummary(sb, photographer.id);
    const grossEarnings = await getTotalGrossEarnings(sb, photographer.id);
    expect(grossEarnings).toBe(summary.totalRevenueCents);

    const earnings = await getPhotographerEarnings(sb, photographer.id);
    expect(earnings).toHaveLength(2);
    const guestEarning = earnings.find((e) => e.photo_id === guestPhoto.id);
    expect(guestEarning?.buyer_email).toBe('guest@example.com');
    expect(guestEarning?.gross_amount_cents).toBe(900);
  });

  it('getRecentSales returns the true newest rows across both paths under a limit', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });

    // Three sales per path, interleaved in time; the two NEWEST overall are one
    // from each path. With more rows per table than the limit, the per-table DB
    // ORDER BY created_at DESC + LIMIT is required — dropping it would return an
    // arbitrary (typically oldest-first) page and miss the newest rows.
    const g1 = await createTestPhoto(event.id, { user_id: photographer.id });
    const a1 = await createTestPhoto(event.id, { user_id: photographer.id });
    const g2 = await createTestPhoto(event.id, { user_id: photographer.id });
    const a2 = await createTestPhoto(event.id, { user_id: photographer.id });
    const newAuthed = await createTestPhoto(event.id, { user_id: photographer.id });
    const newGuest = await createTestPhoto(event.id, { user_id: photographer.id });

    await seedGuestSale('g@example.com', photographer.id, g1.id, 500, '2026-01-01T00:00:00Z');
    await seedAuthedSale(buyer.id, photographer.id, a1.id, 500, '2026-02-01T00:00:00Z');
    await seedGuestSale('g@example.com', photographer.id, g2.id, 500, '2026-03-01T00:00:00Z');
    await seedAuthedSale(buyer.id, photographer.id, a2.id, 500, '2026-04-01T00:00:00Z');
    await seedAuthedSale(buyer.id, photographer.id, newAuthed.id, 500, '2026-06-01T00:00:00Z');
    await seedGuestSale('g@example.com', photographer.id, newGuest.id, 500, '2026-07-01T00:00:00Z');

    const recent = await getRecentSales(sb, photographer.id, 2);
    expect(recent.map((s) => s.photo_id)).toEqual([newGuest.id, newAuthed.id]);
  });
});
