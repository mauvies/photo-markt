'use server';

import {
  getRecentSales,
  getSalesOverTime,
  getSalesSummary,
  getTopSellingEvents,
} from '@/database/queries';
import { calculateNetEarnings, calculatePlatformFee } from '@/database/queries/earnings';
import { hasBundlePricingConfigured } from '@/database/queries/events';
import { getPhotographerPlanIds } from '@/database/queries/subscriptions';
import { createClient } from '@/database/server';
import { getPlatformFeeRate } from '@/lib/plans';

export async function getSalesDataAction(startDate?: string, endDate?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const [summary, salesOverTime, topEvents, recentSales, planMap, hasBundlePricing] =
    await Promise.all([
      getSalesSummary(supabase, user.id, startDate, endDate),
      getSalesOverTime(supabase, user.id, startDate, endDate, 'day'),
      getTopSellingEvents(supabase, user.id, 10, startDate, endDate),
      getRecentSales(supabase, user.id, 20, startDate, endDate),
      getPhotographerPlanIds(supabase, [user.id]),
      hasBundlePricingConfigured(supabase, user.id),
    ]);

  const planId = planMap.get(user.id) ?? null;
  const feeRate = getPlatformFeeRate(planId);

  // `unit_price_cents` is the amount actually charged for that photo — the
  // allocated share of a bundle-discounted total when one applied (T-204).
  // Commission and net come from the SAME two functions the Earnings tab uses
  // (T-205): this used to be a second, hand-inlined copy of the formula, and
  // the whole point of T-197 is that two derivations of one figure eventually
  // disagree. Sharing them makes "both tabs report the same breakdown for the
  // same sale" true by construction rather than by the two expressions
  // happening to match.
  const salesWithFees = recentSales.map((sale) => ({
    ...sale,
    commission_cents: calculatePlatformFee(sale.unit_price_cents, planId),
    net_earnings_cents: calculateNetEarnings(sale.unit_price_cents, planId),
  }));

  return {
    summary,
    salesOverTime,
    topEvents,
    recentSales: salesWithFees,
    platformFeeRate: feeRate,
    hasBundlePricing,
  };
}
