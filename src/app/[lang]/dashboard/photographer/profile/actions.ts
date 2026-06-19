'use server';

import { getUserEvents } from '@/database/queries/events';
import { getProfile } from '@/database/queries/profiles';
import { getSalesSummary } from '@/database/queries/sales';
import { createClient } from '@/database/server';

export async function getProfileData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  // Calculate date range for all-time stats
  const endDate = new Date();
  const startDate = new Date(0); // Beginning of time
  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  // Fetch profile and stats in parallel
  const [profile, events, salesSummary] = await Promise.all([
    getProfile(supabase, user.id),
    getUserEvents(supabase, user.id),
    getSalesSummary(supabase, user.id, startDateStr, endDateStr),
  ]);

  // Count total photos
  const { count: totalPhotosCount } = await supabase
    .from('photos')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  return {
    profile,
    email: user.email ?? '',
    createdAt: user.created_at ?? new Date().toISOString(),
    stats: {
      totalEvents: events.length,
      totalPhotos: totalPhotosCount ?? 0,
      totalSales: salesSummary.totalSales,
      totalRevenueCents: salesSummary.totalRevenueCents,
    },
  };
}
