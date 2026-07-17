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
 * Calculate platform fee from gross earnings using the photographer's plan rate.
 */
export function calculatePlatformFee(grossEarningsCents: number, feeRate = 0.1): number {
  return Math.round(grossEarningsCents * feeRate);
}

/**
 * Calculate net earnings after platform fee using the photographer's plan rate.
 */
export function calculateNetEarnings(grossEarningsCents: number, feeRate = 0.1): number {
  return grossEarningsCents - calculatePlatformFee(grossEarningsCents, feeRate);
}

/**
 * Get total gross earnings for a photographer from completed orders
 * (authenticated + guest purchases).
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
  const [totalGrossEarningsCents, totalPaidOutCents, pendingPayoutsCents, planIds] =
    await Promise.all([
      getTotalGrossEarnings(supabase, photographerId),
      getTotalPaidOut(supabase, photographerId),
      getTotalPendingPayouts(supabase, photographerId),
      getPhotographerPlanIds(supabase, [photographerId]),
    ]);

  const feeRate = getPlatformFeeRate(planIds.get(photographerId));
  const platformFeeCents = calculatePlatformFee(totalGrossEarningsCents, feeRate);
  const totalNetEarningsCents = calculateNetEarnings(totalGrossEarningsCents, feeRate);
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
  const feeRate = getPlatformFeeRate(planId);

  const emailByUserId = await resolveBuyerEmails(supabase, items);

  return items.map((item) => {
    const grossAmountCents = item.totalPriceCents;
    const platformFeeCents = calculatePlatformFee(grossAmountCents, feeRate);
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
