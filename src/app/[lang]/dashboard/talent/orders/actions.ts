'use server';

import { getUserOrders, type OrderStatus } from '@/database/queries/orders';
import { createPhotoUrls } from '@/database/queries/storage';
import { getErrorMessage } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
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
  /**
   * Up to THUMBNAILS_PER_ORDER preview slots. For `completed` orders these are
   * short-lived signed URLs to the original (un-watermarked) photo — the buyer
   * paid for it. For any other status they are watermarked previews. `null`
   * means the order_item's photo row no longer exists (T-116) — the caller
   * renders a fallback instead of skipping the slot silently.
   */
  thumbnails: (string | null)[];
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
  //
  // Read via the admin client (T-130 pattern): the joined `photos` rows belong
  // to the PHOTOGRAPHER, and `photos` RLS only exposes own rows
  // (`own_photos_select`) — with the user-scoped client the embed silently
  // returned a null photo for every purchased item, so all thumbnails fell back
  // to the "photo no longer available" slot (T-116). Ownership is still
  // enforced: `orderIds` come from `getUserOrders`, scoped to this user's own
  // orders.
  const { data: itemRows, error } = await supabaseAdmin
    .from('order_items')
    .select('order_id, photos(original_url)')
    .in('order_id', orderIds);

  if (error) {
    throw new Error(`Failed to get order items: ${getErrorMessage(error)}`);
  }

  // A slot is `null` when the order_item's photo row no longer exists — the
  // join returns no `photos` row (e.g. a hard-deleted photo bypassing the
  // normal `on delete restrict` FK, such as manual DB cleanup). We keep the
  // slot instead of dropping it so the UI can render an explicit fallback
  // rather than silently showing fewer thumbnails than `item_count`.
  const countsByOrderId = new Map<string, number>();
  const pathsByOrderId = new Map<string, (string | null)[]>();
  for (const row of itemRows ?? []) {
    countsByOrderId.set(row.order_id, (countsByOrderId.get(row.order_id) ?? 0) + 1);
    const photo = Array.isArray(row.photos) ? row.photos[0] : row.photos;
    const path = photo?.original_url ?? null;
    const current = pathsByOrderId.get(row.order_id) ?? [];
    if (current.length < THUMBNAILS_PER_ORDER) {
      current.push(path);
      pathsByOrderId.set(row.order_id, current);
    }
  }

  // `completed` orders are paid for, so we surface the original photo via a
  // short-lived signed URL. Every other status (pending/failed/refunded) stays
  // watermarked. Ownership is already enforced — `getUserOrders` scoped these
  // to the authenticated user's own orders.
  const originalPaths = new Set<string>();
  const watermarkedPaths = new Set<string>();
  for (const order of orders) {
    const target = order.status === 'completed' ? originalPaths : watermarkedPaths;
    for (const path of pathsByOrderId.get(order.id) ?? []) {
      if (path) target.add(path);
    }
  }

  // Sign with the admin client (T-130 pattern): the buyer doesn't own the
  // photographer's storage objects, so signing the `photos` bucket path with
  // the user-scoped client is denied by storage RLS and returns null. The paths
  // being signed all originate from this user's own orders (above), so
  // ownership is preserved.
  const baseUrl = await getBaseUrl();
  const [originalSigned, watermarkedSigned] = await Promise.all([
    originalPaths.size > 0
      ? createPhotoUrls(supabaseAdmin, 'photos', [...originalPaths], {
          expiresIn: 3600,
          useWatermark: false,
        })
      : Promise.resolve([]),
    watermarkedPaths.size > 0
      ? createPhotoUrls(supabaseAdmin, 'photos', [...watermarkedPaths], {
          expiresIn: 3600,
          useWatermark: true,
          baseUrl,
        })
      : Promise.resolve([]),
  ]);
  const originalUrls = Object.fromEntries(originalSigned.map((u) => [u.path, u.signedUrl]));
  const watermarkedUrls = Object.fromEntries(watermarkedSigned.map((u) => [u.path, u.signedUrl]));

  return orders.map((order) => {
    const paths = pathsByOrderId.get(order.id) ?? [];
    const urls = order.status === 'completed' ? originalUrls : watermarkedUrls;
    const thumbnails = paths.map((p) => (p ? (urls[p] ?? null) : null));
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
