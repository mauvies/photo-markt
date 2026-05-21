/**
 * Talent Library - queries for owned photos (purchased + claimed-free)
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface PurchasedPhoto {
  photo_id: string;
  original_url: string | null;
  taken_at: string | null;
  purchased_at: string;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
  event_city: string | null;
  event_country: string | null;
  photographer_id: string;
  photographer_username: string | null;
  photographer_display_name: string | null;
  order_id: string;
}

/**
 * A photo the talent owns — either purchased (via an order) or claimed (a
 * free event photo added to their profile). `acquired_via` discriminates;
 * `order_id` is null for claimed photos.
 */
export interface OwnedPhoto extends Omit<PurchasedPhoto, 'order_id'> {
  order_id: string | null;
  acquired_via: 'purchase' | 'claim';
}

/**
 * Get all photos purchased by a talent user
 */
export async function getTalentPurchasedPhotos(
  supabase: SupabaseServerClient,
  talentUserId: string,
  options?: {
    limit?: number;
    offset?: number;
  },
): Promise<PurchasedPhoto[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  // Get all completed orders for this user
  const { data: completedOrders, error: ordersError } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', talentUserId)
    .eq('status', 'completed');

  if (ordersError) {
    throw new Error(`Failed to get completed orders: ${getErrorMessage(ordersError)}`);
  }

  if (!completedOrders || completedOrders.length === 0) {
    return [];
  }

  const orderIds = completedOrders.map((o) => o.id);

  // Get order items with photo and event details
  const { data, error } = await supabase
    .from('order_items')
    .select(
      `
      photo_id,
      photographer_id,
      created_at,
      order_id,
      photos!inner(
        original_url,
        taken_at,
        event_id,
        events(
          name,
          date,
          city,
          country
        )
      )
    `,
    )
    .in('order_id', orderIds)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to get purchased photos: ${getErrorMessage(error)}`);
  }

  // Get photographer profiles
  const photographerIds = [...new Set((data ?? []).map((item) => item.photographer_id))];
  const photographerProfilesMap: Record<
    string,
    { username: string | null; display_name: string | null }
  > = {};

  if (photographerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', photographerIds);

    if (profiles) {
      for (const profile of profiles) {
        photographerProfilesMap[profile.id] = {
          username: profile.username,
          display_name: profile.display_name,
        };
      }
    }
  }

  // Transform data
  return (data ?? []).map(
    (item: {
      photo_id: string;
      photographer_id: string;
      created_at: string;
      order_id: string;
      photos:
        | Array<{
            original_url: string | null;
            taken_at: string | null;
            event_id: string | null;
            events:
              | Array<{
                  name: string | null;
                  date: string | null;
                  city: string | null;
                  country: string | null;
                }>
              | {
                  name: string | null;
                  date: string | null;
                  city: string | null;
                  country: string | null;
                }
              | null;
          }>
        | {
            original_url: string | null;
            taken_at: string | null;
            event_id: string | null;
            events:
              | Array<{
                  name: string | null;
                  date: string | null;
                  city: string | null;
                  country: string | null;
                }>
              | {
                  name: string | null;
                  date: string | null;
                  city: string | null;
                  country: string | null;
                }
              | null;
          }
        | null;
    }) => {
      const photo = Array.isArray(item.photos) ? item.photos[0] : item.photos;
      const event = photo ? (Array.isArray(photo.events) ? photo.events[0] : photo.events) : null;
      const photographer = photographerProfilesMap[item.photographer_id] ?? {
        username: null,
        display_name: null,
      };

      return {
        photo_id: item.photo_id,
        original_url: photo?.original_url ?? null,
        taken_at: photo?.taken_at ?? null,
        purchased_at: item.created_at,
        event_id: photo?.event_id ?? null,
        event_name: event?.name ?? null,
        event_date: event?.date ?? null,
        event_city: event?.city ?? null,
        event_country: event?.country ?? null,
        photographer_id: item.photographer_id,
        photographer_username: photographer.username,
        photographer_display_name: photographer.display_name,
        order_id: item.order_id,
      };
    },
  ) as PurchasedPhoto[];
}

/**
 * Get count of purchased photos for a talent user
 */
export async function getTalentPurchasedPhotosCount(
  supabase: SupabaseServerClient,
  talentUserId: string,
): Promise<number> {
  // Get all completed orders for this user
  const { data: completedOrders, error: ordersError } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', talentUserId)
    .eq('status', 'completed');

  if (ordersError) {
    throw new Error(`Failed to get completed orders: ${getErrorMessage(ordersError)}`);
  }

  if (!completedOrders || completedOrders.length === 0) {
    return 0;
  }

  const orderIds = completedOrders.map((o) => o.id);

  const { count, error } = await supabase
    .from('order_items')
    .select('*', { count: 'exact', head: true })
    .in('order_id', orderIds);

  if (error) {
    throw new Error(`Failed to get purchased photos count: ${getErrorMessage(error)}`);
  }

  return count ?? 0;
}

/**
 * Get unique event count from purchased photos
 */
export async function getTalentPurchasedEventsCount(
  supabase: SupabaseServerClient,
  talentUserId: string,
): Promise<number> {
  // Get all completed orders for this user
  const { data: completedOrders, error: ordersError } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', talentUserId)
    .eq('status', 'completed');

  if (ordersError) {
    throw new Error(`Failed to get completed orders: ${getErrorMessage(ordersError)}`);
  }

  if (!completedOrders || completedOrders.length === 0) {
    return 0;
  }

  const orderIds = completedOrders.map((o) => o.id);

  // Get unique event IDs from purchased photos
  const { data, error } = await supabase
    .from('order_items')
    .select(
      `
      photos!inner(
        event_id
      )
    `,
    )
    .in('order_id', orderIds);

  if (error) {
    throw new Error(`Failed to get purchased events count: ${getErrorMessage(error)}`);
  }

  const eventIds = new Set<string>();
  (data ?? []).forEach(
    (item: { photos: Array<{ event_id: string | null }> | { event_id: string | null } | null }) => {
      const photo = Array.isArray(item.photos) ? item.photos[0] : item.photos;
      if (photo?.event_id) {
        eventIds.add(photo.event_id);
      }
    },
  );

  return eventIds.size;
}

// ─── Claimed free photos ("Add to my profile") ──────────────────────────────

/** Event fields embedded in a photo join — Supabase returns object or [object]. */
type JoinedEvent = {
  name: string | null;
  date: string | null;
  city: string | null;
  country: string | null;
  user_id: string;
};

type ClaimedRow = {
  photo_id: string;
  claimed_at: string;
  photos:
    | Array<{
        original_url: string | null;
        taken_at: string | null;
        event_id: string | null;
        events: JoinedEvent[] | JoinedEvent | null;
      }>
    | {
        original_url: string | null;
        taken_at: string | null;
        event_id: string | null;
        events: JoinedEvent[] | JoinedEvent | null;
      }
    | null;
};

/**
 * Claim a free event photo into the talent's owned-photos collection.
 * Idempotent — a duplicate claim (unique-violation) is treated as success.
 * The caller is responsible for verifying the photo's event is free.
 */
export async function claimPhotoForTalent(
  supabase: SupabaseServerClient,
  photoId: string,
  talentUserId: string,
): Promise<void> {
  const { error } = await supabase
    .from('talent_claimed_photos')
    .insert({ photo_id: photoId, talent_user_id: talentUserId });
  // 23505 = unique violation — already claimed; idempotent success.
  if (error && error.code !== '23505') {
    throw new Error(`Failed to claim photo: ${getErrorMessage(error)}`);
  }
}

/**
 * The set of photo IDs the talent has claimed. Pass `photoIds` to scope the
 * lookup to a candidate list (e.g. the photos on one event page).
 */
export async function getClaimedPhotoIdsForTalent(
  supabase: SupabaseServerClient,
  talentUserId: string,
  photoIds?: string[],
): Promise<Set<string>> {
  if (photoIds && photoIds.length === 0) return new Set();
  let query = supabase
    .from('talent_claimed_photos')
    .select('photo_id')
    .eq('talent_user_id', talentUserId);
  if (photoIds) query = query.in('photo_id', photoIds);
  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to get claimed photos: ${getErrorMessage(error)}`);
  }
  return new Set((data ?? []).map((row) => row.photo_id as string));
}

/** Count of photos the talent has claimed. */
export async function getClaimedPhotoCountForTalent(
  supabase: SupabaseServerClient,
  talentUserId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('talent_claimed_photos')
    .select('*', { count: 'exact', head: true })
    .eq('talent_user_id', talentUserId);
  if (error) {
    throw new Error(`Failed to count claimed photos: ${getErrorMessage(error)}`);
  }
  return count ?? 0;
}

/** Photos the talent has claimed, shaped like purchased photos. */
export async function getTalentClaimedPhotos(
  supabase: SupabaseServerClient,
  talentUserId: string,
  options?: { limit?: number; offset?: number },
): Promise<OwnedPhoto[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  const { data, error } = await supabase
    .from('talent_claimed_photos')
    .select(
      `
      photo_id,
      claimed_at,
      photos!inner(
        original_url,
        taken_at,
        event_id,
        events(
          name,
          date,
          city,
          country,
          user_id
        )
      )
    `,
    )
    .eq('talent_user_id', talentUserId)
    .order('claimed_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to get claimed photos: ${getErrorMessage(error)}`);
  }

  const rows = (data ?? []) as ClaimedRow[];
  const photoOf = (r: ClaimedRow) => (Array.isArray(r.photos) ? r.photos[0] : r.photos);
  const eventOf = (r: ClaimedRow) => {
    const photo = photoOf(r);
    if (!photo) return null;
    return Array.isArray(photo.events) ? (photo.events[0] ?? null) : photo.events;
  };

  // Resolve the event owners' display names (the "photographer" of a claim).
  const ownerIds = [
    ...new Set(rows.map((r) => eventOf(r)?.user_id).filter((v): v is string => Boolean(v))),
  ];
  const ownerProfiles: Record<string, { username: string | null; display_name: string | null }> =
    {};
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', ownerIds);
    for (const p of profiles ?? []) {
      ownerProfiles[p.id] = { username: p.username, display_name: p.display_name };
    }
  }

  return rows.map((r) => {
    const photo = photoOf(r);
    const event = eventOf(r);
    const ownerId = event?.user_id ?? '';
    const owner = ownerProfiles[ownerId] ?? { username: null, display_name: null };
    return {
      photo_id: r.photo_id,
      original_url: photo?.original_url ?? null,
      taken_at: photo?.taken_at ?? null,
      purchased_at: r.claimed_at,
      event_id: photo?.event_id ?? null,
      event_name: event?.name ?? null,
      event_date: event?.date ?? null,
      event_city: event?.city ?? null,
      event_country: event?.country ?? null,
      photographer_id: ownerId,
      photographer_username: owner.username,
      photographer_display_name: owner.display_name,
      order_id: null,
      acquired_via: 'claim' as const,
    };
  });
}

/**
 * All photos the talent owns — purchased ∪ claimed, newest first. A photo's
 * event is either free or paid, so purchased and claimed sets never overlap.
 */
export async function getTalentOwnedPhotos(
  supabase: SupabaseServerClient,
  talentUserId: string,
  options?: { limit?: number; offset?: number },
): Promise<OwnedPhoto[]> {
  const [purchased, claimed] = await Promise.all([
    getTalentPurchasedPhotos(supabase, talentUserId, { limit: 500 }),
    getTalentClaimedPhotos(supabase, talentUserId, { limit: 500 }),
  ]);

  const byPhoto = new Map<string, OwnedPhoto>();
  for (const p of purchased) {
    byPhoto.set(p.photo_id, { ...p, order_id: p.order_id, acquired_via: 'purchase' });
  }
  for (const c of claimed) {
    if (!byPhoto.has(c.photo_id)) byPhoto.set(c.photo_id, c);
  }

  const merged = [...byPhoto.values()].sort(
    (a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime(),
  );
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;
  return merged.slice(offset, offset + limit);
}

/** Count of all owned photos — purchased + claimed (the two never overlap). */
export async function getTalentOwnedPhotosCount(
  supabase: SupabaseServerClient,
  talentUserId: string,
): Promise<number> {
  const [purchased, claimed] = await Promise.all([
    getTalentPurchasedPhotosCount(supabase, talentUserId),
    getClaimedPhotoCountForTalent(supabase, talentUserId),
  ]);
  return purchased + claimed;
}
