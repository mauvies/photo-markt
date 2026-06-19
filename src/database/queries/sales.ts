/**
 * Sales-related database queries
 */

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
 * Get sales summary for a photographer
 * Queries completed orders from the orders table
 */
export async function getSalesSummary(
  supabase: SupabaseServerClient,
  photographerId: string,
  startDate?: string,
  endDate?: string,
): Promise<SalesSummary> {
  // Query order_items for this photographer with completed orders
  const query = supabase
    .from('order_items')
    .select(
      `
      total_price_cents,
      quantity,
      created_at,
      orders!inner(
        id,
        status,
        created_at
      )
    `,
    )
    .eq('photographer_id', photographerId)
    .eq('orders.status', 'completed');

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get sales summary: ${getErrorMessage(error)}`);
  }

  // Calculate totals
  const items = (data ?? []) as Array<{
    total_price_cents: number;
    quantity: number;
    created_at: string;
    orders:
      | Array<{ id: string; status: string; created_at: string }>
      | { id: string; status: string; created_at: string };
  }>;

  // Filter by orders.created_at if date filters are provided
  let filteredItems = items;
  if (startDate || endDate) {
    filteredItems = items.filter((item) => {
      const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
      const orderDate = order?.created_at ?? item.created_at;
      if (startDate && orderDate < startDate) return false;
      if (endDate && orderDate > endDate) return false;
      return true;
    });
  }

  const totalRevenueCents = filteredItems.reduce((sum, item) => sum + item.total_price_cents, 0);
  const totalPhotosSold = filteredItems.reduce((sum, item) => sum + item.quantity, 0);
  const uniqueOrders = new Set(
    filteredItems
      .map((item) => {
        const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
        return order?.id;
      })
      .filter((id): id is string => Boolean(id)),
  );
  const totalSales = uniqueOrders.size;
  const averageOrderValueCents = totalSales > 0 ? Math.round(totalRevenueCents / totalSales) : 0;

  return {
    totalRevenueCents,
    totalSales,
    averageOrderValueCents,
    totalPhotosSold,
  };
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
  const [current, previous] = await Promise.all([
    getSalesSummary(supabase, photographerId, periodStart, periodEnd),
    getSalesSummary(supabase, photographerId, prevStart, prevEnd),
  ]);

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
 * Get sales over time grouped by date
 * Queries completed orders from the orders table
 */
export async function getSalesOverTime(
  supabase: SupabaseServerClient,
  photographerId: string,
  startDate?: string,
  endDate?: string,
  groupBy: 'day' | 'week' | 'month' = 'day',
): Promise<SalesByDate[]> {
  const query = supabase
    .from('order_items')
    .select(
      `
      total_price_cents,
      quantity,
      created_at,
      orders!inner(
        id,
        created_at,
        status
      )
    `,
    )
    .eq('photographer_id', photographerId)
    .eq('orders.status', 'completed')
    .order('created_at', { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get sales over time: ${getErrorMessage(error)}`);
  }

  // Group by date
  const grouped = new Map<string, { revenue: number; count: number }>();

  const items = (data ?? []) as Array<{
    total_price_cents: number;
    quantity: number;
    created_at: string;
    orders:
      | Array<{ id: string; created_at: string; status: string }>
      | { id: string; created_at: string; status: string };
  }>;

  items.forEach((item) => {
    // Use order.created_at if available, otherwise fall back to order_items.created_at
    const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
    const orderDate = order?.created_at ?? item.created_at;

    // Filter by orders.created_at if date filters are provided
    if (startDate || endDate) {
      if (startDate && orderDate < startDate) return;
      if (endDate && orderDate > endDate) return;
    }

    const date = new Date(orderDate);
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
      revenue: current.revenue + item.total_price_cents,
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
 * Get top selling events
 * Queries completed orders from the orders table
 */
export async function getTopSellingEvents(
  supabase: SupabaseServerClient,
  photographerId: string,
  limit = 10,
  startDate?: string,
  endDate?: string,
): Promise<TopSellingEvent[]> {
  // First, get order items with photos (without joining events to avoid filtering out deleted events)
  const query = supabase
    .from('order_items')
    .select(
      `
      photo_id,
      total_price_cents,
      quantity,
      created_at,
      orders!inner(
        id,
        created_at,
        status
      ),
      photos!inner(
        event_id
      )
    `,
    )
    .eq('photographer_id', photographerId)
    .eq('orders.status', 'completed');

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get top selling events: ${getErrorMessage(error)}`);
  }

  // Group by event_id first
  const grouped = new Map<
    string,
    {
      sales_count: number;
      revenue_cents: number;
      photos_sold: Set<string>;
    }
  >();

  const items = (data ?? []) as Array<{
    photo_id: string;
    total_price_cents: number;
    quantity: number;
    created_at: string;
    orders:
      | Array<{ id: string; created_at: string; status: string }>
      | { id: string; created_at: string; status: string };
    photos: Array<{ event_id: string | null }> | { event_id: string | null };
  }>;

  const eventIds = new Set<string>();

  items.forEach((item) => {
    // Handle Supabase returning orders as array or single object
    const order = Array.isArray(item.orders) ? (item.orders[0] ?? null) : item.orders;

    // Filter by orders.created_at if date filters are provided
    if (startDate || endDate) {
      const orderDate = order?.created_at ?? item.created_at;
      if (startDate && orderDate < startDate) return;
      if (endDate && orderDate > endDate) return;
    }

    // Handle Supabase returning photos as array or single object
    const photo = Array.isArray(item.photos) ? (item.photos[0] ?? null) : item.photos;

    if (!photo || !photo.event_id) return;

    const eventId = photo.event_id;
    eventIds.add(eventId);

    const current = grouped.get(eventId) ?? {
      sales_count: 0,
      revenue_cents: 0,
      photos_sold: new Set<string>(),
    };

    current.photos_sold.add(item.photo_id);
    grouped.set(eventId, {
      ...current,
      sales_count: current.sales_count + item.quantity,
      revenue_cents: current.revenue_cents + item.total_price_cents,
    });
  });

  // Fetch event details including deleted events (for metrics purposes)
  // Note: We include deleted events here because we want to show historical metrics
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

  // Build final results with event details
  // For deleted events, we still show their name (since we're using soft deletes)
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
 * Get recent sales with details
 * Queries completed orders from the orders table
 */
export async function getRecentSales(
  supabase: SupabaseServerClient,
  photographerId: string,
  limit = 20,
  startDate?: string,
  endDate?: string,
): Promise<Sale[]> {
  const query = supabase
    .from('order_items')
    .select(
      `
      id,
      photo_id,
      photographer_id,
      total_price_cents,
      quantity,
      created_at,
      orders!inner(
        id,
        user_id,
        created_at,
        status
      ),
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
    .eq('photographer_id', photographerId)
    .eq('orders.status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get recent sales: ${getErrorMessage(error)}`);
  }

  const items = (data ?? []) as Array<{
    id: string;
    photo_id: string;
    photographer_id: string;
    total_price_cents: number;
    quantity: number;
    created_at: string;
    orders:
      | Array<{
          id: string;
          user_id: string;
          created_at: string;
          status: string;
        }>
      | { id: string; user_id: string; created_at: string; status: string };
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

  // Filter by orders.created_at if date filters are provided
  let filteredItems = items;
  if (startDate || endDate) {
    filteredItems = items.filter((item) => {
      const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
      const orderDate = order?.created_at ?? item.created_at;
      if (startDate && orderDate < startDate) return false;
      if (endDate && orderDate > endDate) return false;
      return true;
    });
  }

  // Get unique buyer IDs
  const buyerIds = [
    ...new Set(
      filteredItems
        .map((item) => {
          const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
          return order?.user_id;
        })
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];

  // Fetch user emails using RPC function if available
  const buyerEmailMap: Record<string, string | null> = {};

  if (buyerIds.length > 0) {
    try {
      // Try to use the batch RPC function if it exists
      const { data: userEmails } = await supabase.rpc('get_user_emails_batch', {
        user_ids: buyerIds,
      });

      if (userEmails) {
        for (const user of userEmails) {
          buyerEmailMap[user.id] = user.email ?? null;
        }
      }
    } catch {
      // RPC function might not exist or might fail, continue without emails
    }
  }

  return filteredItems.map((item) => {
    const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
    const photo = Array.isArray(item.photos) ? item.photos[0] : item.photos;
    const event = photo
      ? Array.isArray(photo.events)
        ? (photo.events[0] ?? null)
        : photo.events
      : null;

    return {
      id: item.id,
      photo_id: item.photo_id,
      photographer_id: item.photographer_id,
      unit_price_cents: item.total_price_cents,
      commission_cents: 0,
      net_earnings_cents: item.total_price_cents,
      created_at: order?.created_at ?? item.created_at,
      photo_url: photo?.original_url ?? null,
      event_id: photo?.event_id ?? null,
      event_name: event?.name ?? null,
      event_date: event?.date ?? null,
      buyer_id: order?.user_id ?? '',
      buyer_email: buyerEmailMap[order?.user_id ?? ''] ?? null,
    };
  }) as Sale[];
}
