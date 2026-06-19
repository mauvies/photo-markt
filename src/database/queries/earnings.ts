/**
 * Earnings-related database queries
 * For calculating photographer earnings and balances
 */

import { getPhotographerNetCents, getPlatformFeeRate } from '@/lib/plans';
import { getTotalPaidOut, getTotalPendingPayouts } from './payouts';
import { getPhotographerPlanIds } from './subscriptions';
import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

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
 */
export async function getTotalGrossEarnings(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<number> {
  const { data: orderItems, error: itemsError } = await supabase
    .from('order_items')
    .select(
      `
      total_price_cents,
      orders!inner(
        status
      )
    `,
    )
    .eq('photographer_id', photographerId)
    .eq('orders.status', 'completed');

  if (itemsError) {
    throw new Error(`Failed to get total gross earnings: ${getErrorMessage(itemsError)}`);
  }

  return (orderItems ?? []).reduce((sum, item) => sum + (item.total_price_cents as number), 0);
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
  let query = supabase
    .from('order_items')
    .select(
      `
      id,
      order_id,
      photo_id,
      total_price_cents,
      created_at,
      orders!inner(
        id,
        user_id,
        created_at,
        status
      ),
      photos(
        event_id,
        events(
          name,
          date
        )
      )
    `,
    )
    .eq('photographer_id', photographerId)
    .eq('orders.status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (startDate) {
    query = query.gte('created_at', startDate);
  }
  if (endDate) {
    query = query.lte('created_at', endDate);
  }

  const [{ data, error }, planIds] = await Promise.all([
    query,
    getPhotographerPlanIds(supabase, [photographerId]),
  ]);

  if (error) {
    throw new Error(`Failed to get photographer earnings: ${getErrorMessage(error)}`);
  }

  const feeRate = getPlatformFeeRate(planIds.get(photographerId));

  type OrderItemWithRelations = {
    id: string;
    order_id: string;
    photo_id: string;
    total_price_cents: number;
    created_at: string;
    orders:
      | {
          id: string;
          user_id: string;
          created_at: string;
          status: string;
        }[]
      | {
          id: string;
          user_id: string;
          created_at: string;
          status: string;
        }
      | null;
    photos:
      | {
          event_id: string | null;
          events:
            | {
                name: string;
                date: string;
              }[]
            | {
                name: string;
                date: string;
              }
            | null;
        }[]
      | {
          event_id: string | null;
          events:
            | {
                name: string;
                date: string;
              }[]
            | {
                name: string;
                date: string;
              }
            | null;
        }
      | null;
  };

  // Get unique buyer IDs
  const buyerIds = [
    ...new Set(
      (data ?? [])
        .map((item: OrderItemWithRelations) => {
          const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
          return order?.user_id;
        })
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];

  // Fetch user emails using RPC function if available
  const buyerEmailMap: Record<string, string | null> = {};

  if (buyerIds.length > 0) {
    try {
      const { data: userEmails } = await supabase.rpc('get_user_emails_batch', {
        user_ids: buyerIds,
      });

      if (userEmails) {
        for (const user of userEmails) {
          buyerEmailMap[user.id] = user.email ?? null;
        }
      }
    } catch {
      // RPC function might not exist or might fail, continue without emails
    }
  }

  return (data ?? []).map((item: OrderItemWithRelations) => {
    const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
    const photo = Array.isArray(item.photos) ? item.photos[0] : item.photos;
    const event = Array.isArray(photo?.events) ? photo.events[0] : photo?.events;

    const grossAmountCents = item.total_price_cents;
    const platformFeeCents = calculatePlatformFee(grossAmountCents, feeRate);
    const netAmountCents = getPhotographerNetCents(grossAmountCents, planIds.get(photographerId));

    return {
      id: item.id,
      order_id: item.order_id,
      photo_id: item.photo_id,
      event_id: photo?.event_id ?? null,
      event_name: event?.name ?? null,
      event_date: event?.date ?? null,
      buyer_id: order?.user_id ?? '',
      buyer_email: buyerEmailMap[order?.user_id ?? ''] ?? null,
      gross_amount_cents: grossAmountCents,
      platform_fee_cents: platformFeeCents,
      net_amount_cents: netAmountCents,
      created_at: item.created_at,
    };
  });
}
