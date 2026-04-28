'use server';

import { getUserOrders } from '@/database/queries/orders';
import { getProfile } from '@/database/queries/profiles';
import { getTaggedPhotosCountForTalent } from '@/database/queries/talent-photo-tags';
import { createClient } from '@/database/server';

/** Fetch the current talent user's profile and account stats for the settings page. */
export async function getProfileData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  // Fetch profile and stats in parallel
  const [profile, taggedPhotosCount, recentOrders] = await Promise.all([
    getProfile(supabase, user.id),
    getTaggedPhotosCountForTalent(supabase, user.id),
    getUserOrders(supabase, user.id, 10),
  ]);

  // Calculate total purchased photos
  let totalPurchasedPhotos = 0;
  const { data: allCompletedOrders } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'completed');

  if (allCompletedOrders && allCompletedOrders.length > 0) {
    const { count: purchasedCount } = await supabase
      .from('order_items')
      .select('*', { count: 'exact', head: true })
      .in(
        'order_id',
        allCompletedOrders.map((o) => o.id),
      );

    totalPurchasedPhotos = purchasedCount ?? 0;
  }

  return {
    profile,
    email: user.email ?? '',
    createdAt: user.created_at ?? new Date().toISOString(),
    stats: {
      taggedPhotosCount,
      purchasedPhotosCount: totalPurchasedPhotos,
      totalOrders: recentOrders.length,
    },
  };
}
