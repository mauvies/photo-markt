'use server';

import { cacheLife, cacheTag } from 'next/cache';
import { getUserEvents } from '@/database/queries/events';
import { getSalesOverTime, getSalesSummary, getTopSellingEvents } from '@/database/queries/sales';
import { getCurrentPlan } from '@/database/queries/subscriptions';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';

async function getCachedDashboardData(userId: string) {
  'use cache';
  cacheTag(`dashboard-photographer-${userId}`, `photographer-events-${userId}`);
  cacheLife('minutes');

  const LOOKBACK_DAYS = 30;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);
  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  // Fetch all data in parallel
  const [salesSummary, salesOverTime, topEvents, allEvents] = await Promise.all([
    getSalesSummary(supabaseAdmin, userId, startDateStr, endDateStr),
    getSalesOverTime(supabaseAdmin, userId, startDateStr, endDateStr, 'day'),
    getTopSellingEvents(supabaseAdmin, userId, 1, startDateStr, endDateStr),
    getUserEvents(supabaseAdmin, userId),
  ]);

  const [{ count: totalPhotosCount }, sizeRowsResult, currentPlan] = await Promise.all([
    supabaseAdmin.from('photos').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabaseAdmin.from('photos').select('size_bytes').eq('user_id', userId),
    getCurrentPlan(supabaseAdmin, userId),
  ]);

  if (sizeRowsResult.error) {
    console.error('Failed to fetch photo sizes for storage usage:', sizeRowsResult.error);
  }
  const usedBytes = (sizeRowsResult.data ?? []).reduce<number>(
    (acc, row) => acc + (typeof row.size_bytes === 'number' ? row.size_bytes : 0),
    0,
  );
  const storageUsedGB = usedBytes / 1024 ** 3;
  const storageLimitGB = currentPlan.storageGB ?? 0;
  const storageUsedPercent =
    storageLimitGB > 0 ? Math.min((storageUsedGB / storageLimitGB) * 100, 100) : 0;

  return {
    salesSummary,
    salesOverTime,
    topEvent: topEvents[0] || null,
    totalEvents: allEvents.length,
    storage: {
      usedGB: storageUsedGB,
      limitGB: storageLimitGB,
      usedPercent: storageUsedPercent,
      totalPhotos: totalPhotosCount ?? 0,
    },
  };
}

/**
 * Fetch cached analytics and storage data for the photographer dashboard overview.
 */
export async function getDashboardData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  return getCachedDashboardData(user.id);
}
