/**
 * Sales-related database queries
 *
 * Sales come from two independent purchase paths that MUST both be counted:
 *   - Authenticated buyers  → `order_items` + `orders` (status='completed')
 *   - Guest (unauth) buyers → `guest_order_items` + `guest_orders`
 *
 * `getCompletedSaleItems` unifies the two into one normalized list so no
 * reporting surface can silently drop guest sales (the T-144 bug: Ventas read
 * only `order_items` while Ganancias-resumen read `payouts`, so guest sales —
 * which write `guest_order_items` + `payouts` but never `order_items` — showed
 * up under Earnings but never under Sales).
 *
 * Guest tables have RLS enabled with NO policies, so they are only readable via
 * `supabaseAdmin` (service role). The always-present `.eq('photographer_id', …)`
 * filter keeps a photographer scoped to their own guest sales despite the
 * service-role bypass.
 */

import { supabaseAdmin } from '@/database/supabase-admin';
import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface Sale {
  id: string;
  photo_id: string;
  photographer_id: string;
  unit_price_cents: number;
  commission_cents: number;
  net_earnings_cents: number;
  created_at: string;
  photo_url: string | null;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
  buyer_id: string;
  buyer_email: string | null;
}

export interface SalesSummary {
  totalRevenueCents: number;
  totalSales: number;
  averageOrderValueCents: number;
  totalPhotosSold: number;
}

export interface SalesTrend {
  revenuePct: number;
  salesPct: number;
  photosPct: number;
}

export interface SalesSummaryWithTrend {
  current: SalesSummary;
  previous: SalesSummary;
  trend: SalesTrend | null;
}

export interface SalesByDate {
  date: string;
  revenue_cents: number;
  sales_count: number;
}

export interface TopSellingPhoto {
  photo_id: string;
  photo_url: string | null;
  event_id: string | null;
  event_name: string | null;
  sales_count: number;
  revenue_cents: number;
}

export interface TopSellingEvent {
  event_id: string;
  event_name: string | null;
  event_date: string | null;
  sales_count: number;
  revenue_cents: number;
  photos_sold: number;
}

/**
 * A single completed sale line item, normalized across the authenticated and
 * guest purchase paths.
 */
export interface CompletedSaleItem {
  itemId: string;
  /** Parent order id — `orders.id` for authed, `guest_orders.id` for guest. */
  orderId: string;
  photoId: string;
  totalPriceCents: number;
  quantity: number;
  /** Purchase time (parent order created_at). */
  createdAt: string;
  isGuest: boolean;
  /** Authenticated buyer's user id (email resolved later via RPC). Null for guests. */
  buyerUserId: string | null;
  /** Guest buyer's email (inline from `guest_orders`). Null for authed rows. */
  buyerEmail: string | null;
  photoUrl: string | null;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
}

/** Supabase returns a to-one relation as either a single object or a 1-element array. */
function firstOf<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function withinRange(dateIso: string, startDate?: string, endDate?: string): boolean {
  if (startDate && dateIso < startDate) return false;
  if (endDate && dateIso > endDate) return false;
  return true;
}

type NestedEvent = { name: string | null; date: string | null };
type NestedPhoto = {
  original_url: string | null;
  event_id: string | null;
  events: NestedEvent[] | NestedEvent | null;
};
type AuthedOrderRel = { id: string; user_id: string; created_at: string; status: string };
type GuestOrderRel = {
  id: string;
  guest_email: string | null;
  created_at: string;
  status: string;
};

type AuthedItemRow = {
  id: string;
  order_id: string;
  photo_id: string;
  total_price_cents: number;
  quantity: number;
  created_at: string;
  orders: AuthedOrderRel[] | AuthedOrderRel | null;
  photos: NestedPhoto[] | NestedPhoto | null;
};

type GuestItemRow = {
  id: string;
  guest_order_id: string;
  photo_id: string;
  total_price_cents: number;
  quantity: number;
  created_at: string;
  guest_orders: GuestOrderRel[] | GuestOrderRel | null;
  photos: NestedPhoto[] | NestedPhoto | null;
};

function normalizePhoto(photo: NestedPhoto | null): {
  photoUrl: string | null;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
} {
  const event = photo ? firstOf(photo.events) : null;
  return {
    photoUrl: photo?.original_url ?? null,
    eventId: photo?.event_id ?? null,
    eventName: event?.name ?? null,
    eventDate: event?.date ?? null,
  };
}

export interface SaleItemsFilter {
  /** Inclusive lower bound on the line item's `created_at` (ISO). */
  startDate?: string;
  /** Inclusive upper bound on the line item's `created_at` (ISO). */
  endDate?: string;
  /**
   * Cap the number of (newest-first) rows. Pushed to the DB per table, so the
   * merged result is the true newest `limit` rows across both paths. Omit for
   * aggregate callers that must sum over every row.
   */
  limit?: number;
  /**
   * Join `photos`→`events` for photo url / event name+date. Default true.
   * Summary/over-time/gross-total callers set false — they never read those
   * fields, so the join is pure cost.
   */
  includePhotoDetails?: boolean;
}

const PHOTO_JOIN_FRAGMENT = `,
        photos(
          original_url,
          event_id,
          events(
            name,
            date
          )
        )`;

/**
 * Fetch completed sale line items for a photographer across both the
 * authenticated (`order_items`) and guest (`guest_order_items`) paths, as one
 * normalized, newest-first list. This is the single source of truth for all
 * sales/earnings reporting so guest sales can never be dropped by an individual
 * surface.
 *
 * Ordering, the date range, and `limit` are pushed down to the DB **per table**
 * (PostgREST caps a page at `max_rows`, so an unordered/unlimited fetch could
 * silently truncate and drop the newest rows). List callers pass `limit`; the
 * merged result is then the correct newest `limit` across both paths. Aggregate
 * callers omit `limit` — they must sum every matching row — and rely on the date
 * range to keep the scan bounded.
 *
 * The canonical timestamp is the line item's `created_at` (the column ordered,
 * filtered, and limited on); it equals the parent order's created_at in
 * practice, both being stamped when the webhook writes the sale.
 */
export async function getCompletedSaleItems(
  supabase: SupabaseServerClient,
  photographerId: string,
  filter: SaleItemsFilter = {},
): Promise<CompletedSaleItem[]> {
  const { startDate, endDate, limit, includePhotoDetails = true } = filter;
  const photoJoin = includePhotoDetails ? PHOTO_JOIN_FRAGMENT : '';

  let authedQuery = supabase
    .from('order_items')
    .select(
      `
        id,
        order_id,
        photo_id,
        total_price_cents,
        quantity,
        created_at,
        orders!inner(
          id,
          user_id,
          created_at,
          status
        )${photoJoin}
      `,
    )
    .eq('photographer_id', photographerId)
    .eq('orders.status', 'completed')
    .order('created_at', { ascending: false });

  let guestQuery = supabaseAdmin
    .from('guest_order_items')
    .select(
      `
        id,
        guest_order_id,
        photo_id,
        total_price_cents,
        quantity,
        created_at,
        guest_orders!inner(
          id,
          guest_email,
          created_at,
          status
        )${photoJoin}
      `,
    )
    .eq('photographer_id', photographerId)
    .eq('guest_orders.status', 'completed')
    .order('created_at', { ascending: false });

  // Push the date range and row cap down to the DB per table so PostgREST's
  // page cap can't silently truncate the newest rows out of the result.
  if (startDate) {
    authedQuery = authedQuery.gte('created_at', startDate);
    guestQuery = guestQuery.gte('created_at', startDate);
  }
  if (endDate) {
    authedQuery = authedQuery.lte('created_at', endDate);
    guestQuery = guestQuery.lte('created_at', endDate);
  }
  if (limit !== undefined) {
    authedQuery = authedQuery.limit(limit);
    guestQuery = guestQuery.limit(limit);
  }

  const [authed, guest] = await Promise.all([authedQuery, guestQuery]);

  if (authed.error) {
    throw new Error(`Failed to get sale items: ${getErrorMessage(authed.error)}`);
  }
  if (guest.error) {
    throw new Error(`Failed to get guest sale items: ${getErrorMessage(guest.error)}`);
  }

  const items: CompletedSaleItem[] = [];

  // The select string is built with a runtime-conditional photo join, which
  // defeats PostgREST's compile-time row-type inference (it types `.data` as a
  // ParserError). The query is still validated server-side; cast through
  // `unknown` to the shape we know it returns.
  for (const raw of (authed.data ?? []) as unknown as AuthedItemRow[]) {
    const order = firstOf(raw.orders);
    const photo = normalizePhoto(firstOf(raw.photos));
    items.push({
      itemId: raw.id,
      orderId: order?.id ?? raw.order_id,
      photoId: raw.photo_id,
      totalPriceCents: raw.total_price_cents,
      quantity: raw.quantity,
      createdAt: raw.created_at,
      isGuest: false,
      buyerUserId: order?.user_id ?? null,
      buyerEmail: null,
      ...photo,
    });
  }

  for (const raw of (guest.data ?? []) as unknown as GuestItemRow[]) {
    const order = firstOf(raw.guest_orders);
    const photo = normalizePhoto(firstOf(raw.photos));
    items.push({
      itemId: raw.id,
      orderId: order?.id ?? raw.guest_order_id,
      photoId: raw.photo_id,
      totalPriceCents: raw.total_price_cents,
      quantity: raw.quantity,
      createdAt: raw.created_at,
      isGuest: true,
      buyerUserId: null,
      buyerEmail: order?.guest_email ?? null,
      ...photo,
    });
  }

  // Merge is newest-first; when `limit` was applied per table, the true newest
  // `limit` across both paths is a subset of the (≤2·limit) merged rows.
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return limit !== undefined ? items.slice(0, limit) : items;
}

/**
 * Resolve buyer emails for a set of sale items. Guest emails are already inline
 * on the item; authenticated buyers are looked up in a single batched RPC.
 */
export async function resolveBuyerEmails(
  supabase: SupabaseServerClient,
  items: CompletedSaleItem[],
): Promise<Map<string, string | null>> {
  const emailByUserId = new Map<string, string | null>();

  const buyerIds = [
    ...new Set(
      items
        .filter((i) => !i.isGuest)
        .map((i) => i.buyerUserId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];

  if (buyerIds.length > 0) {
    try {
      const { data: userEmails } = await supabase.rpc('get_user_emails_batch', {
        user_ids: buyerIds,
      });
      if (userEmails) {
        for (const user of userEmails) {
          emailByUserId.set(user.id, user.email ?? null);
        }
      }
    } catch {
      // RPC function might not exist or might fail — continue without emails.
    }
  }

  return emailByUserId;
}

/** Aggregate a set of already-scoped sale items into a summary. */
function summarizeItems(items: CompletedSaleItem[]): SalesSummary {
  const totalRevenueCents = items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const totalPhotosSold = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalSales = new Set(items.map((item) => item.orderId)).size;
  const averageOrderValueCents = totalSales > 0 ? Math.round(totalRevenueCents / totalSales) : 0;

  return {
    totalRevenueCents,
    totalSales,
    averageOrderValueCents,
    totalPhotosSold,
  };
}

/**
 * Get sales summary for a photographer (authenticated + guest purchases).
 */
export async function getSalesSummary(
  supabase: SupabaseServerClient,
  photographerId: string,
  startDate?: string,
  endDate?: string,
): Promise<SalesSummary> {
  const items = await getCompletedSaleItems(supabase, photographerId, {
    startDate,
    endDate,
    includePhotoDetails: false,
  });
  return summarizeItems(items);
}

/**
 * Compute a percent delta. Returns null when the previous period had zero
 * activity so callers can omit the trend indicator instead of rendering a
 * meaningless "+∞%" or "0%".
 */
export function computeTrendPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Get a sales summary for the current period alongside the previous period of
 * equal length, plus pre-computed percent deltas. Trend is null when the
 * previous period contributed no revenue (i.e. nothing meaningful to compare
 * against).
 */
export async function getSalesSummaryWithTrend(
  supabase: SupabaseServerClient,
  photographerId: string,
  periodStart: string,
  periodEnd: string,
  prevStart: string,
  prevEnd: string,
): Promise<SalesSummaryWithTrend> {
  // The two periods are contiguous (previous immediately precedes current), so a
  // single fetch spanning [prevStart, periodEnd] covers both — then partition in
  // memory instead of paying for two full DB round trips.
  const items = await getCompletedSaleItems(supabase, photographerId, {
    startDate: prevStart,
    endDate: periodEnd,
    includePhotoDetails: false,
  });
  const current = summarizeItems(
    items.filter((item) => withinRange(item.createdAt, periodStart, periodEnd)),
  );
  const previous = summarizeItems(
    items.filter((item) => withinRange(item.createdAt, prevStart, prevEnd)),
  );

  if (previous.totalRevenueCents === 0) {
    return { current, previous, trend: null };
  }

  return {
    current,
    previous,
    trend: {
      revenuePct: computeTrendPct(current.totalRevenueCents, previous.totalRevenueCents) ?? 0,
      salesPct: computeTrendPct(current.totalSales, previous.totalSales) ?? 0,
      photosPct: computeTrendPct(current.totalPhotosSold, previous.totalPhotosSold) ?? 0,
    },
  };
}

/**
 * Get sales over time grouped by date (authenticated + guest purchases).
 */
export async function getSalesOverTime(
  supabase: SupabaseServerClient,
  photographerId: string,
  startDate?: string,
  endDate?: string,
  groupBy: 'day' | 'week' | 'month' = 'day',
): Promise<SalesByDate[]> {
  const items = await getCompletedSaleItems(supabase, photographerId, {
    startDate,
    endDate,
    includePhotoDetails: false,
  });

  const grouped = new Map<string, { revenue: number; count: number }>();

  items.forEach((item) => {
    const date = new Date(item.createdAt);
    let key: string;

    if (groupBy === 'day') {
      key = date.toISOString().split('T')[0];
    } else if (groupBy === 'week') {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      key = weekStart.toISOString().split('T')[0];
    } else {
      // month
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    const current = grouped.get(key) ?? { revenue: 0, count: 0 };
    grouped.set(key, {
      revenue: current.revenue + item.totalPriceCents,
      count: current.count + item.quantity,
    });
  });

  return Array.from(grouped.entries())
    .map(([date, stats]) => ({
      date,
      revenue_cents: stats.revenue,
      sales_count: stats.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get top selling photos
 *
 * NOTE: This reads from `cart_items`, not from completed orders, and is not
 * wired into the sales dashboard. Left as-is (out of T-144 scope).
 */
export async function getTopSellingPhotos(
  supabase: SupabaseServerClient,
  photographerId: string,
  limit = 10,
  startDate?: string,
  endDate?: string,
): Promise<TopSellingPhoto[]> {
  let query = supabase
    .from('cart_items')
    .select(
      `
      photo_id,
      unit_price_cents,
      created_at,
      photos(
        original_url,
        event_id,
        events(
          name,
          date
        )
      )
    `,
    )
    .eq('photographer_id', photographerId);

  if (startDate) {
    query = query.gte('created_at', startDate);
  }
  if (endDate) {
    query = query.lte('created_at', endDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get top selling photos: ${getErrorMessage(error)}`);
  }

  // Group by photo_id
  const grouped = new Map<
    string,
    {
      photo_url: string | null;
      event_id: string | null;
      event_name: string | null;
      sales_count: number;
      revenue_cents: number;
    }
  >();

  const items = (data ?? []) as Array<{
    photo_id: string;
    unit_price_cents: number;
    photos:
      | Array<{
          original_url: string | null;
          event_id: string | null;
          events:
            | Array<{ name: string | null; date: string | null }>
            | { name: string | null; date: string | null }
            | null;
        }>
      | {
          original_url: string | null;
          event_id: string | null;
          events:
            | Array<{ name: string | null; date: string | null }>
            | { name: string | null; date: string | null }
            | null;
        }
      | null;
  }>;

  items.forEach((item) => {
    const photo = Array.isArray(item.photos) ? item.photos[0] : item.photos;
    const event = photo ? (Array.isArray(photo.events) ? photo.events[0] : photo.events) : null;

    const current = grouped.get(item.photo_id) ?? {
      photo_url: photo?.original_url ?? null,
      event_id: photo?.event_id ?? null,
      event_name: event?.name ?? null,
      sales_count: 0,
      revenue_cents: 0,
    };

    grouped.set(item.photo_id, {
      ...current,
      sales_count: current.sales_count + 1,
      revenue_cents: current.revenue_cents + item.unit_price_cents,
    });
  });

  return Array.from(grouped.entries())
    .map(([photo_id, stats]) => ({
      photo_id,
      photo_url: stats.photo_url,
      event_id: stats.event_id,
      event_name: stats.event_name,
      sales_count: stats.sales_count,
      revenue_cents: stats.revenue_cents,
    }))
    .sort((a, b) => b.sales_count - a.sales_count)
    .slice(0, limit);
}

/**
 * Get top selling events (authenticated + guest purchases).
 */
export async function getTopSellingEvents(
  supabase: SupabaseServerClient,
  photographerId: string,
  limit = 10,
  startDate?: string,
  endDate?: string,
): Promise<TopSellingEvent[]> {
  // Needs each item's event_id (from the photos join) to attribute the sale.
  const items = await getCompletedSaleItems(supabase, photographerId, { startDate, endDate });

  // Group by event_id first
  const grouped = new Map<
    string,
    {
      sales_count: number;
      revenue_cents: number;
      photos_sold: Set<string>;
    }
  >();

  const eventIds = new Set<string>();

  items.forEach((item) => {
    if (!item.eventId) return;

    const eventId = item.eventId;
    eventIds.add(eventId);

    const current = grouped.get(eventId) ?? {
      sales_count: 0,
      revenue_cents: 0,
      photos_sold: new Set<string>(),
    };

    current.photos_sold.add(item.photoId);
    grouped.set(eventId, {
      ...current,
      sales_count: current.sales_count + item.quantity,
      revenue_cents: current.revenue_cents + item.totalPriceCents,
    });
  });

  // Fetch event details including deleted events (for metrics purposes).
  // We include deleted events here because we want to show historical metrics.
  const eventDetailsMap = new Map<
    string,
    { name: string | null; date: string | null; deleted_at: string | null }
  >();

  if (eventIds.size > 0) {
    const { data: events } = await supabase
      .from('events')
      .select('id, name, date, deleted_at')
      .in('id', Array.from(eventIds));

    if (events) {
      for (const event of events) {
        eventDetailsMap.set(event.id, {
          name: event.name,
          date: event.date,
          deleted_at: event.deleted_at,
        });
      }
    }
  }

  // Build final results with event details.
  // For deleted events, we still show their name (since we're using soft deletes).
  return Array.from(grouped.entries())
    .map(([event_id, stats]) => {
      const eventDetails = eventDetailsMap.get(event_id);
      // If event doesn't exist in DB (shouldn't happen with soft deletes, but handle gracefully)
      if (!eventDetails) {
        return {
          event_id,
          event_name: 'Deleted Event',
          event_date: null,
          sales_count: stats.sales_count,
          revenue_cents: stats.revenue_cents,
          photos_sold: stats.photos_sold.size,
        };
      }
      return {
        event_id,
        event_name: eventDetails.name ?? 'Unnamed Event',
        event_date: eventDetails.date ?? null,
        sales_count: stats.sales_count,
        revenue_cents: stats.revenue_cents,
        photos_sold: stats.photos_sold.size,
      };
    })
    .sort((a, b) => b.revenue_cents - a.revenue_cents)
    .slice(0, limit);
}

/**
 * Get recent sales with details (authenticated + guest purchases).
 */
export async function getRecentSales(
  supabase: SupabaseServerClient,
  photographerId: string,
  limit = 20,
  startDate?: string,
  endDate?: string,
): Promise<Sale[]> {
  // The DB returns the newest `limit` rows across both paths, already sorted.
  const items = await getCompletedSaleItems(supabase, photographerId, {
    startDate,
    endDate,
    limit,
  });

  const emailByUserId = await resolveBuyerEmails(supabase, items);

  return items.map((item) => ({
    id: item.itemId,
    photo_id: item.photoId,
    photographer_id: photographerId,
    unit_price_cents: item.totalPriceCents,
    commission_cents: 0,
    net_earnings_cents: item.totalPriceCents,
    created_at: item.createdAt,
    photo_url: item.photoUrl,
    event_id: item.eventId,
    event_name: item.eventName,
    event_date: item.eventDate,
    buyer_id: item.buyerUserId ?? '',
    buyer_email: item.isGuest
      ? item.buyerEmail
      : (emailByUserId.get(item.buyerUserId ?? '') ?? null),
  }));
}
