'use server';

import { getUserOrders, type OrderStatus } from '@/database/queries/orders';
import { createPhotoUrls } from '@/database/queries/storage';
import { getErrorMessage } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { getBaseUrl } from '@/lib/get-base-url';

/**
 * Max number of thumbnail previews returned per order. The orders list shows a
 * stacked preview; 4 is enough to suggest "more than a couple" without
 * ballooning signed-URL generation across the full page.
 */
const THUMBNAILS_PER_ORDER = 4;

export interface OrderWithItemCount {
  id: string;
  status: OrderStatus;
  total_amount_cents: number;
  currency: string;
  created_at: string;
  completed_at: string | null;
  item_count: number;
  /** Up to THUMBNAILS_PER_ORDER watermarked preview URLs. */
  thumbnails: string[];
}

export async function getTalentOrders(): Promise<OrderWithItemCount[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const orders = await getUserOrders(supabase, user.id, 100);

  if (orders.length === 0) {
    return [];
  }

  const orderIds = orders.map((o) => o.id);

  // Pull item count + a handful of photo paths per order in a single query.
  // We select more rows than we'll show so we can take the first N per order
  // when materializing thumbnails.
  const { data: itemRows, error } = await supabase
    .from('order_items')
    .select('order_id, photos(original_url)')
    .in('order_id', orderIds);

  if (error) {
    throw new Error(`Failed to get order items: ${getErrorMessage(error)}`);
  }

  const countsByOrderId = new Map<string, number>();
  const pathsByOrderId = new Map<string, string[]>();
  for (const row of itemRows ?? []) {
    countsByOrderId.set(row.order_id, (countsByOrderId.get(row.order_id) ?? 0) + 1);
    const photo = Array.isArray(row.photos) ? row.photos[0] : row.photos;
    const path = photo?.original_url;
    if (!path) continue;
    const current = pathsByOrderId.get(row.order_id) ?? [];
    if (current.length < THUMBNAILS_PER_ORDER) {
      current.push(path);
      pathsByOrderId.set(row.order_id, current);
    }
  }

  // Batch all thumbnail paths into one signed-URL request. Watermarked
  // previews keep us safe even if a photo's order later refunds — we never
  // expose the original storage path on this page.
  const allPaths = Array.from(pathsByOrderId.values()).flat();
  const baseUrl = await getBaseUrl();
  const signedUrlsMap: Record<string, string | null> =
    allPaths.length > 0
      ? Object.fromEntries(
          (
            await createPhotoUrls(supabase, 'photos', allPaths, {
              expiresIn: 3600,
              useWatermark: true,
              baseUrl,
            })
          ).map((u) => [u.path, u.signedUrl]),
        )
      : {};

  return orders.map((order) => {
    const paths = pathsByOrderId.get(order.id) ?? [];
    const thumbnails = paths
      .map((p) => signedUrlsMap[p])
      .filter((url): url is string => Boolean(url));
    return {
      id: order.id,
      status: order.status,
      total_amount_cents: order.total_amount_cents,
      currency: order.currency,
      created_at: order.created_at,
      completed_at: order.completed_at,
      item_count: countsByOrderId.get(order.id) ?? 0,
      thumbnails,
    };
  });
}

export async function getTalentOrderStats() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const orders = await getUserOrders(supabase, user.id, 1000);
  const completedOrders = orders.filter((o) => o.status === 'completed');

  let totalPurchasedPhotos = 0;
  if (completedOrders.length > 0) {
    const { count } = await supabase
      .from('order_items')
      .select('*', { count: 'exact', head: true })
      .in(
        'order_id',
        completedOrders.map((o) => o.id),
      );
    totalPurchasedPhotos = count ?? 0;
  }

  return {
    totalOrders: orders.length,
    completedOrders: completedOrders.length,
    totalPurchasedPhotos,
    totalSpentCents: completedOrders.reduce((sum, order) => sum + order.total_amount_cents, 0),
  };
}
