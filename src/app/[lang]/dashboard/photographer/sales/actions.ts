'use server';

import {
  getRecentSales,
  getSalesOverTime,
  getSalesSummary,
  getTopSellingEvents,
} from '@/database/queries';
import { getPhotographerPlanIds } from '@/database/queries/subscriptions';
import { createClient } from '@/database/server';
import { getPhotographerNetCents, getPlatformFeeRate } from '@/lib/plans';

export async function getSalesDataAction(startDate?: string, endDate?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const [summary, salesOverTime, topEvents, recentSales, planMap] = await Promise.all([
    getSalesSummary(supabase, user.id, startDate, endDate),
    getSalesOverTime(supabase, user.id, startDate, endDate, 'day'),
    getTopSellingEvents(supabase, user.id, 10, startDate, endDate),
    getRecentSales(supabase, user.id, 20, startDate, endDate),
    getPhotographerPlanIds(supabase, [user.id]),
  ]);

  const planId = planMap.get(user.id) ?? null;
  const feeRate = getPlatformFeeRate(planId);

  const salesWithFees = recentSales.map((sale) => {
    const net = getPhotographerNetCents(sale.unit_price_cents, planId);
    return {
      ...sale,
      commission_cents: sale.unit_price_cents - net,
      net_earnings_cents: net,
    };
  });

  return {
    summary,
    salesOverTime,
    topEvents,
    recentSales: salesWithFees,
    platformFeeRate: feeRate,
  };
}
