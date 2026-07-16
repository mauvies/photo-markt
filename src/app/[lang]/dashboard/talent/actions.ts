'use server';

import { getCartItemCount } from '@/database/queries/carts';
import { getUserOrders } from '@/database/queries/orders';
import {
  buildTaggedPhotoSignedUrlMap,
  getTaggedPhotosCountForTalent,
  getTaggedPhotosForTalent,
} from '@/database/queries/talent-photo-tags';
import { createClient } from '@/database/server';
import { getBaseUrl } from '@/lib/get-base-url';

// --- Types ---

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type OrderItemWithPhoto = {
  id: string;
  photo_id: string;
  unit_price_cents: number;
  total_price_cents: number;
  photos:
    | {
        original_url: string | null;
        events: { name: string; date: string }[] | { name: string; date: string } | null;
      }[]
    | {
        original_url: string | null;
        events: { name: string; date: string }[] | { name: string; date: string } | null;
      }
    | null;
};

// --- Helpers ---

async function getPurchasedPhotosCount(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data: completedOrders } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'completed');

  if (!completedOrders || completedOrders.length === 0) return 0;

  const { count } = await supabase
    .from('order_items')
    .select('*', { count: 'exact', head: true })
    .in(
      'order_id',
      completedOrders.map((o) => o.id),
    );

  return count ?? 0;
}

async function enrichOrdersWithItems(
  supabase: SupabaseClient,
  orders: Awaited<ReturnType<typeof getUserOrders>>,
) {
  return Promise.all(
    orders.map(async (order) => {
      const { data: items } = await supabase
        .from('order_items')
        .select(
          `
          id,
          photo_id,
          unit_price_cents,
          total_price_cents,
          photos(
            original_url,
            events(
              name,
              date
            )
          )
        `,
        )
        .eq('order_id', order.id)
        .limit(3);

      return {
        ...order,
        items: (items ?? []).map((item: OrderItemWithPhoto) => {
          const photo = Array.isArray(item.photos) ? item.photos[0] : item.photos;
          const event = Array.isArray(photo?.events) ? photo.events[0] : photo?.events;
          return {
            photo_id: item.photo_id,
            unit_price_cents: item.unit_price_cents,
            total_price_cents: item.total_price_cents,
            event_name: event?.name ?? null,
            event_date: event?.date ?? null,
          };
        }),
      };
    }),
  );
}

// --- Export ---

/**
 * Fetch all data needed for the talent dashboard overview page.
 */
export async function getTalentDashboardData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const [taggedPhotosCount, recentTaggedPhotos, cartItemCount, recentOrders] = await Promise.all([
    getTaggedPhotosCountForTalent(supabase, user.id),
    getTaggedPhotosForTalent(supabase, user.id, { limit: 3 }),
    getCartItemCount(supabase, user.id),
    getUserOrders(supabase, user.id, 5),
  ]);

  const [signedUrlsMap, totalPurchasedPhotos, ordersWithItems] = await Promise.all([
    getBaseUrl().then((baseUrl) =>
      buildTaggedPhotoSignedUrlMap(supabase, recentTaggedPhotos, baseUrl),
    ),
    getPurchasedPhotosCount(supabase, user.id),
    enrichOrdersWithItems(supabase, recentOrders),
  ]);

  return {
    stats: {
      taggedPhotosCount,
      purchasedPhotosCount: totalPurchasedPhotos,
      cartItemCount,
      totalOrders: recentOrders.length,
    },
    recentTaggedPhotos: recentTaggedPhotos.map((photo) => ({
      ...photo,
      signed_url: photo.photo_url ? (signedUrlsMap[photo.photo_url] ?? null) : null,
    })),
    recentOrders: ordersWithItems,
  };
}
