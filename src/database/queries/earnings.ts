/**
 * Earnings-related database queries
 * For calculating photographer earnings and balances
 */

import { getPhotographerNetCents, getPlatformFeeRate } from '@/lib/plans';
import { getTotalPaidOut, getTotalPendingPayouts } from './payouts';
import { getCompletedSaleItems, resolveBuyerEmails } from './sales';
import { getPhotographerPlanIds } from './subscriptions';
import type { SupabaseServerClient } from './types';

/**
 * Platform commission on a gross amount, derived as `gross − net` (T-197).
 *
 * It is NOT `round(gross × rate)`, which is what this used to be. The payout is
 * `getPhotographerNetCents` (a floor), so an independently-rounded fee could
 * disagree with it by a cent and the breakdown would not add up: a €0.06 sale
 * on Free showed a €0.00 fee against a €0.05 net, losing a cent. The Sales tab
 * already derived its commission this way, so the two tabs of the same page
 * could report different figures for the same sale.
 *
 * Deriving from the payout makes `gross = fee + net` true by construction, and
 * makes the platform's cut exactly what the photographer did not receive.
 *
 * `planId` rather than a rate, so there is one place (`getPlatformFeeRate`)
 * that maps a plan to its commission — the previous `feeRate = 0.1` default
 * was a stale hardcoded rate matching no plan.
 */
export function calculatePlatformFee(
  grossEarningsCents: number,
  planId: string | null | undefined,
): number {
  return grossEarningsCents - getPhotographerNetCents(grossEarningsCents, planId);
}

/**
 * Net earnings after commission — the photographer's payout. The buyer service
 * fee (billing v2) is NOT part of this in either direction: it is charged to
 * the buyer on top of the price and is platform revenue.
 *
 * Applied per **line item** by the Sales and Earnings tables, which is what
 * makes the two tabs report identical figures for the same sale. The transfer
 * itself is made per order, so a multi-item order's rows can sum to a cent less
 * than its payout (a sum of floors vs the floor of the sum). That is a rounding
 * artefact of the per-photo breakdown, not a discrepancy in the balance: the
 * totals shown at the top of the Earnings tab are netted per order — see
 * `aggregateEarningsByOrder` — so they match the transfers exactly.
 */
export function calculateNetEarnings(
  grossEarningsCents: number,
  planId: string | null | undefined,
): number {
  return getPhotographerNetCents(grossEarningsCents, planId);
}

/**
 * Get total gross earnings for a photographer from completed orders
 * (authenticated + guest purchases).
 *
 * Gross is the **charged** amount: `total_price_cents` carries the allocated
 * share of a bundle-discounted total (T-204) when one applied, and the list
 * price when none did. A discounted sale therefore reports the money that
 * actually came in, never the undiscounted list total.
 */
export async function getTotalGrossEarnings(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<number> {
  const items = await getCompletedSaleItems(supabase, photographerId, {
    includePhotoDetails: false,
  });
  return items.reduce((sum, item) => sum + item.totalPriceCents, 0);
}

export interface EarningsAggregate {
  grossCents: number;
  platformFeeCents: number;
  netCents: number;
}

/**
 * Aggregate a photographer's earnings from the gross of each **order** (T-205).
 *
 * The unit of aggregation is the order, because that is the unit the money
 * moves in: the webhook creates one transfer per `(order, photographer)` for
 * `getPhotographerNetCents(orderGross)`. `getPhotographerNetCents` floors, and
 * a sum of floors is not the floor of a sum — netting the whole period's gross
 * in one call reported up to one cent per order MORE than was ever transferred,
 * which surfaced as a withdrawable balance the photographer could never
 * withdraw. Bundles make the drift likelier, not rarer: an allocated share of a
 * discounted total lands on arbitrary cents far more often than a list price
 * does.
 *
 * Summing per order makes the reported net **equal the transfers by
 * construction**, and `gross = fee + net` still holds because the fee is again
 * derived as the remainder rather than independently rounded (the T-197 rule).
 */
export function aggregateEarningsByOrder(
  orderGrossCents: readonly number[],
  planId: string | null | undefined,
): EarningsAggregate {
  const grossCents = orderGrossCents.reduce((sum, gross) => sum + gross, 0);
  const netCents = orderGrossCents.reduce(
    (sum, gross) => sum + getPhotographerNetCents(gross, planId),
    0,
  );
  return { grossCents, platformFeeCents: grossCents - netCents, netCents };
}

/** Sum each order's gross from a normalized list of sale line items. */
export function sumGrossByOrder(
  items: ReadonlyArray<{ orderId: string; totalPriceCents: number }>,
): number[] {
  const byOrder = new Map<string, number>();
  for (const item of items) {
    byOrder.set(item.orderId, (byOrder.get(item.orderId) ?? 0) + item.totalPriceCents);
  }
  return [...byOrder.values()];
}

/**
 * Get earnings summary for a photographer
 */
export interface EarningsSummary {
  totalGrossEarningsCents: number;
  platformFeeCents: number;
  totalNetEarningsCents: number;
  totalPaidOutCents: number;
  pendingPayoutsCents: number;
  withdrawableBalanceCents: number;
  platformFeeRate: number;
}

export async function getEarningsSummary(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<EarningsSummary> {
  const [items, totalPaidOutCents, pendingPayoutsCents, planIds] = await Promise.all([
    getCompletedSaleItems(supabase, photographerId, { includePhotoDetails: false }),
    getTotalPaidOut(supabase, photographerId),
    getTotalPendingPayouts(supabase, photographerId),
    getPhotographerPlanIds(supabase, [photographerId]),
  ]);

  const planId = planIds.get(photographerId);
  const feeRate = getPlatformFeeRate(planId);
  // Netted per order, the unit the transfers are made in — see
  // `aggregateEarningsByOrder`.
  const {
    grossCents: totalGrossEarningsCents,
    platformFeeCents,
    netCents: totalNetEarningsCents,
  } = aggregateEarningsByOrder(sumGrossByOrder(items), planId);
  const withdrawableBalanceCents = totalNetEarningsCents - totalPaidOutCents - pendingPayoutsCents;

  return {
    totalGrossEarningsCents,
    platformFeeCents,
    totalNetEarningsCents,
    totalPaidOutCents,
    pendingPayoutsCents,
    withdrawableBalanceCents: Math.max(0, withdrawableBalanceCents),
    platformFeeRate: feeRate,
  };
}

/**
 * Get photographer earnings from order items with details
 */
export interface PhotographerEarning {
  id: string;
  order_id: string;
  photo_id: string;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
  buyer_id: string;
  buyer_email: string | null;
  gross_amount_cents: number;
  platform_fee_cents: number;
  net_amount_cents: number;
  created_at: string;
}

export async function getPhotographerEarnings(
  supabase: SupabaseServerClient,
  photographerId: string,
  limit = 50,
  startDate?: string,
  endDate?: string,
): Promise<PhotographerEarning[]> {
  // The DB returns the newest `limit` rows across both paths, already sorted.
  const [items, planIds] = await Promise.all([
    getCompletedSaleItems(supabase, photographerId, { startDate, endDate, limit }),
    getPhotographerPlanIds(supabase, [photographerId]),
  ]);

  const planId = planIds.get(photographerId);

  const emailByUserId = await resolveBuyerEmails(supabase, items);

  return items.map((item) => {
    const grossAmountCents = item.totalPriceCents;
    const platformFeeCents = calculatePlatformFee(grossAmountCents, planId);
    const netAmountCents = getPhotographerNetCents(grossAmountCents, planId);

    return {
      id: item.itemId,
      order_id: item.orderId,
      photo_id: item.photoId,
      event_id: item.eventId,
      event_name: item.eventName,
      event_date: item.eventDate,
      buyer_id: item.buyerUserId ?? '',
      buyer_email: item.isGuest
        ? item.buyerEmail
        : (emailByUserId.get(item.buyerUserId ?? '') ?? null),
      gross_amount_cents: grossAmountCents,
      platform_fee_cents: platformFeeCents,
      net_amount_cents: netAmountCents,
      created_at: item.createdAt,
    };
  });
}
