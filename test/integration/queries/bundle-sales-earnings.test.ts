/**
 * T-205 — Sales and Earnings tell the truth about a bundle-discounted sale.
 *
 * A bundled sale writes one `order_items` row per photo carrying that photo's
 * ALLOCATED share of the discounted total (T-204), so both tabs already read
 * the money that actually came in. What these tests pin is that the two tabs
 * cannot drift apart on it, and that the Earnings totals equal the transfers
 * actually made: transfers are one per `(order, photographer)`, and
 * `getPhotographerNetCents` floors, so netting a whole period's gross in one
 * call reported up to a cent per order that was never paid out — a balance the
 * photographer could see but never withdraw.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getEarningsSummary, getPhotographerEarnings } from '@/database/queries/earnings';
import { hasBundlePricingConfigured } from '@/database/queries/events';
import { getRecentSales, getSalesSummary } from '@/database/queries/sales';
import type { SupabaseServerClient } from '@/database/queries/types';
import { allocateBundleTotalCents } from '@/lib/bundle-pricing';
import { getPhotographerNetCents } from '@/lib/plans';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/**
 * Seed one completed authenticated order whose items carry `allocatedCents`
 * per photo — exactly what the webhook writes for a bundled cart.
 */
async function seedOrder(
  buyerId: string,
  photographerId: string,
  photoIds: string[],
  allocatedCents: number[],
) {
  const sb = createServiceClient();
  const total = allocatedCents.reduce((sum, cents) => sum + cents, 0);
  const { data: order, error } = await sb
    .from('orders')
    .insert({ user_id: buyerId, status: 'completed', total_amount_cents: total })
    .select('id')
    .single();
  if (error || !order) throw new Error(`seedOrder: ${error?.message}`);

  const { error: itemsError } = await sb.from('order_items').insert(
    photoIds.map((photoId, index) => ({
      order_id: order.id,
      photo_id: photoId,
      photographer_id: photographerId,
      unit_price_cents: allocatedCents[index],
      quantity: 1,
      total_price_cents: allocatedCents[index],
    })),
  );
  if (itemsError) throw new Error(`seedOrder items: ${itemsError.message}`);

  return { orderId: order.id, totalCents: total };
}

/** The transfer the webhook makes for that order, recorded as a paid payout. */
async function seedPayoutForOrder(photographerId: string, orderGrossCents: number) {
  const sb = createServiceClient();
  const netCents = getPhotographerNetCents(orderGrossCents, null);
  const { error } = await sb.from('payouts').insert({
    photographer_id: photographerId,
    amount_cents: netCents,
    status: 'paid',
    stripe_transfer_id: `tr_test_${crypto.randomUUID()}`,
    paid_at: new Date().toISOString(),
  });
  if (error) throw new Error(`seedPayoutForOrder: ${error.message}`);
  return netCents;
}

describe('T-205 — bundled sales in Sales and Earnings', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('reports the discounted total, never the list total, and both tabs agree', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    // 8 photos listing at €3.00, sold as the €19.90 pack from the design.
    const event = await createTestEvent(photographer.id, { price_per_photo: 3 });
    const photos = await Promise.all(
      Array.from({ length: 8 }, () => createTestPhoto(event.id, { user_id: photographer.id })),
    );
    const allocated = allocateBundleTotalCents(1990, 8);

    await seedOrder(
      buyer.id,
      photographer.id,
      photos.map((p) => p.id),
      allocated,
    );

    const salesSummary = await getSalesSummary(sb, photographer.id);
    expect(salesSummary.totalRevenueCents).toBe(1990);
    expect(salesSummary.totalRevenueCents).not.toBe(8 * 300);

    const earningsSummary = await getEarningsSummary(sb, photographer.id);
    expect(earningsSummary.totalGrossEarningsCents).toBe(1990);
    expect(earningsSummary.totalNetEarningsCents).toBe(getPhotographerNetCents(1990, null));
    expect(earningsSummary.platformFeeCents + earningsSummary.totalNetEarningsCents).toBe(1990);

    // Row by row, the two tabs read the same gross for the same sale — the
    // breakdown each derives from it is the same two functions (T-197/T-205).
    const sales = await getRecentSales(sb, photographer.id);
    const earnings = await getPhotographerEarnings(sb, photographer.id);
    const salesByPhoto = new Map(sales.map((s) => [s.photo_id, s.unit_price_cents]));
    const earningsByPhoto = new Map(earnings.map((e) => [e.photo_id, e.gross_amount_cents]));

    expect(salesByPhoto.size).toBe(8);
    for (const [photoId, grossCents] of earningsByPhoto) {
      expect(salesByPhoto.get(photoId)).toBe(grossCents);
      const commission = earnings.find((e) => e.photo_id === photoId)?.platform_fee_cents ?? -1;
      const net = earnings.find((e) => e.photo_id === photoId)?.net_amount_cents ?? -1;
      expect(commission + net).toBe(grossCents);
    }
    expect([...earningsByPhoto.values()].reduce((sum, cents) => sum + cents, 0)).toBe(1990);
  });

  it('a mixed period of bundled and single sales totals to the payouts transferred', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    // €5.13 a photo: 513 × 0.92 = 471.96, so each order forfeits almost a whole
    // cent to the floor and two of them forfeit almost two. Netting the period
    // in one call reports 943 where 942 was transferred.
    const event = await createTestEvent(photographer.id, { price_per_photo: 5.13 });
    const bundlePhotos = await Promise.all([
      createTestPhoto(event.id, { user_id: photographer.id }),
      createTestPhoto(event.id, { user_id: photographer.id }),
    ]);
    const singlePhoto = await createTestPhoto(event.id, { user_id: photographer.id });

    // One bundled order (2 photos for 513) and one single sale at list price.
    const bundled = await seedOrder(
      buyer.id,
      photographer.id,
      bundlePhotos.map((p) => p.id),
      allocateBundleTotalCents(513, 2),
    );
    const single = await seedOrder(buyer.id, photographer.id, [singlePhoto.id], [513]);

    const paidOut =
      (await seedPayoutForOrder(photographer.id, bundled.totalCents)) +
      (await seedPayoutForOrder(photographer.id, single.totalCents));
    expect(paidOut).toBe(942);

    const summary = await getEarningsSummary(sb, photographer.id);

    expect(summary.totalGrossEarningsCents).toBe(1026);
    // The regression: 943 before the fix — a cent that was never transferred.
    expect(summary.totalNetEarningsCents).toBe(paidOut);
    expect(summary.platformFeeCents + summary.totalNetEarningsCents).toBe(
      summary.totalGrossEarningsCents,
    );
    // And so the balance is genuinely settled, not a cent that can never be paid.
    expect(summary.totalPaidOutCents).toBe(paidOut);
    expect(summary.withdrawableBalanceCents).toBe(0);
  });

  it('unbundled sales are unaffected — the totals are exactly today’s', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });

    const order = await seedOrder(buyer.id, photographer.id, [photo.id], [500]);

    const summary = await getEarningsSummary(sb, photographer.id);
    expect(summary.totalGrossEarningsCents).toBe(500);
    expect(summary.totalNetEarningsCents).toBe(getPhotographerNetCents(order.totalCents, null));
    expect(summary.platformFeeCents).toBe(500 - summary.totalNetEarningsCents);
  });
});

describe('T-205 — the bundle-discount note only speaks when there is a bundle', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('is silent for a photographer with no volume pricing configured', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    await createTestEvent(photographer.id, { price_per_photo: 5 });

    expect(await hasBundlePricingConfigured(sb, photographer.id)).toBe(false);
  });

  it('speaks when any of their events carries a ladder or an all-photos cap', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const admin = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const other = await createTestUser('PHOTOGRAPHER');

    const laddered = await createTestEvent(photographer.id, { price_per_photo: 5 });
    await admin
      .from('events')
      .update({ bundle_tiers: [{ minQuantity: 3, totalPriceCents: 1200 }] })
      .eq('id', laddered.id);

    expect(await hasBundlePricingConfigured(sb, photographer.id)).toBe(true);
    // Scoped to the owner — another photographer's ladder is not theirs to explain.
    expect(await hasBundlePricingConfigured(sb, other.id)).toBe(false);

    const capped = await createTestEvent(other.id, { price_per_photo: 5 });
    await admin.from('events').update({ bundle_all_photos_cents: 1990 }).eq('id', capped.id);
    expect(await hasBundlePricingConfigured(sb, other.id)).toBe(true);
  });
});
