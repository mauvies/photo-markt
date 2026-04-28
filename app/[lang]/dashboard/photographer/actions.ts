'use server';

import { cacheLife, cacheTag } from 'next/cache';
import { getUserEvents } from '@/database/queries/events';
import { getSalesOverTime, getSalesSummary, getTopSellingEvents } from '@/database/queries/sales';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getPlanById } from '@/lib/plans';

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

  const ESTIMATED_MB_PER_PHOTO = 5;

  const { count: totalPhotosCount } = await supabaseAdmin
    .from('photos')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const estimatedStorageGB = ((totalPhotosCount ?? 0) * ESTIMATED_MB_PER_PHOTO) / 1024;
  const currentPlan = getPlanById('free');
  const storageLimitGB = currentPlan?.storageGB ?? 1;
  const storageUsedGB = estimatedStorageGB;
  const storageUsedPercent = Math.min((storageUsedGB / storageLimitGB) * 100, 100);

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
