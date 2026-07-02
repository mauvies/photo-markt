'use server';

import { cacheLife, cacheTag } from 'next/cache';
import {
  getEventsCoverPaths,
  getEventsCreatedCount,
  getUserEvents,
} from '@/database/queries/events';
import {
  getPhotosForEvents,
  getPhotosUploadedCount,
  getStorageUsageBytes,
} from '@/database/queries/photos';
import {
  getRecentSales,
  getSalesOverTime,
  getSalesSummaryWithTrend,
  getTopSellingEvents,
} from '@/database/queries/sales';
import { createSignedUrl } from '@/database/queries/storage';
import { getCurrentPlan } from '@/database/queries/subscriptions';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';

const SIGNED_URL_TTL = 60 * 55;

export type DashboardRange = '7d' | '30d' | '3m';

export interface ChartPoint {
  date: string;
  earnings: number;
}

export interface RecentSale {
  id: string;
  photoUrl: string | null;
  eventId: string | null;
  eventName: string | null;
  amountCents: number;
  createdAt: string;
  buyerEmailMasked: string | null;
}

export interface RecentEvent {
  id: string;
  name: string;
  date: string;
  city: string;
  country: string;
  activity: string;
  isPublic: boolean;
  slug: string | null;
  photoCount: number;
  coverUrl: string | null;
}

export interface DashboardData {
  metrics: {
    earningsCents: number;
    sales: number;
    photosUploaded: number;
    eventsCreated: number;
    trend: {
      earningsPct: number | null;
      salesPct: number | null;
      photosPct: number | null;
      eventsPct: number | null;
    };
  };
  totals: {
    totalEvents: number;
    totalPhotos: number;
  };
  storage: {
    usedGB: number;
    limitGB: number;
    usedPercent: number;
  };
  topEvent: {
    event_id: string;
    event_name: string | null;
    event_date: string | null;
    revenue_cents: number;
    photos_sold: number;
  } | null;
  initialRange: DashboardRange;
  initialSeries: ChartPoint[];
  recentSales: RecentSale[];
  recentEvents: RecentEvent[];
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

/**
 * Convert a range token to the date window used by both summary trend math
 * and chart series queries. Previous window is the same calendar-day span
 * immediately before the current window.
 */
function rangeToDates(range: DashboardRange): {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  groupBy: 'day' | 'week';
} {
  const end = new Date();
  const start = new Date(end);
  let groupBy: 'day' | 'week' = 'day';

  if (range === '7d') {
    start.setUTCDate(start.getUTCDate() - 7);
  } else if (range === '3m') {
    start.setUTCMonth(start.getUTCMonth() - 3);
    groupBy = 'week';
  } else {
    start.setUTCDate(start.getUTCDate() - 30);
  }

  const windowMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start);
  const prevStart = new Date(prevEnd.getTime() - windowMs);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    prevStart: prevStart.toISOString(),
    prevEnd: prevEnd.toISOString(),
    groupBy,
  };
}

function monthBounds(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayOfMonth = now.getUTCDate();
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevEnd = new Date(prevStart);
  prevEnd.setUTCDate(dayOfMonth);
  return {
    start: start.toISOString(),
    end: now.toISOString(),
    prevStart: prevStart.toISOString(),
    prevEnd: prevEnd.toISOString(),
  };
}

async function getCachedDashboardData(userId: string): Promise<DashboardData> {
  'use cache';
  cacheTag(`dashboard-photographer-${userId}`, `photographer-events-${userId}`);
  cacheLife('minutes');

  const now = new Date();
  const month = monthBounds(now);
  const initialRange: DashboardRange = '30d';
  const rangeWindow = rangeToDates(initialRange);

  const [
    salesSummary,
    initialSeriesRows,
    topEvents,
    allEvents,
    photosThisMonth,
    photosLastMonth,
    eventsThisMonth,
    eventsLastMonth,
    recentSalesRaw,
    currentPlan,
    usedBytes,
    totalPhotosCountResult,
  ] = await Promise.all([
    getSalesSummaryWithTrend(
      supabaseAdmin,
      userId,
      month.start,
      month.end,
      month.prevStart,
      month.prevEnd,
    ),
    getSalesOverTime(
      supabaseAdmin,
      userId,
      rangeWindow.start,
      rangeWindow.end,
      rangeWindow.groupBy,
    ),
    getTopSellingEvents(supabaseAdmin, userId, 1, month.start, month.end),
    getUserEvents(supabaseAdmin, userId),
    getPhotosUploadedCount(supabaseAdmin, userId, month.start, month.end),
    getPhotosUploadedCount(supabaseAdmin, userId, month.prevStart, month.prevEnd),
    getEventsCreatedCount(supabaseAdmin, userId, month.start, month.end),
    getEventsCreatedCount(supabaseAdmin, userId, month.prevStart, month.prevEnd),
    getRecentSales(supabaseAdmin, userId, 5),
    getCurrentPlan(supabaseAdmin, userId),
    getStorageUsageBytes(supabaseAdmin, userId),
    supabaseAdmin.from('photos').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);

  const storageUsedGB = usedBytes / 1024 ** 3;
  const storageLimitGB = currentPlan.storageGB ?? 0;
  const storageUsedPercent =
    storageLimitGB > 0 ? Math.min((storageUsedGB / storageLimitGB) * 100, 100) : 0;

  const computePct = (current: number, previous: number): number | null => {
    if (previous === 0) return null;
    return ((current - previous) / previous) * 100;
  };

  const initialSeries: ChartPoint[] = initialSeriesRows.map((row) => ({
    date: row.date,
    earnings: row.revenue_cents,
  }));

  const recentSaleSignedUrls = await Promise.all(
    recentSalesRaw.map(async (s) =>
      s.photo_url ? createSignedUrl(supabaseAdmin, 'photos', s.photo_url, SIGNED_URL_TTL) : null,
    ),
  );
  const recentSales: RecentSale[] = recentSalesRaw.map((s, i) => ({
    id: s.id,
    photoUrl: recentSaleSignedUrls[i],
    eventId: s.event_id,
    eventName: s.event_name,
    amountCents: s.unit_price_cents,
    createdAt: s.created_at,
    buyerEmailMasked: maskEmail(s.buyer_email),
  }));

  // Build recent events list (5 most recent) with cover URLs from existing photos.
  const recentEventSlice = allEvents.slice(0, 5);
  const recentEventIds = recentEventSlice.map((e) => e.id);
  // Photos and cover paths are independent reads — fetch them in parallel.
  const [photoRows, coverOverride] = recentEventIds.length
    ? await Promise.all([
        getPhotosForEvents(supabaseAdmin, recentEventIds),
        getEventsCoverPaths(supabaseAdmin, recentEventIds),
      ])
    : [[], new Map<string, string>()];
  const coverPathByEvent = new Map<string, string>();
  const photoCountByEvent = new Map<string, number>();
  for (const row of photoRows) {
    if (!row.event_id) continue;
    photoCountByEvent.set(row.event_id, (photoCountByEvent.get(row.event_id) ?? 0) + 1);
    if (!coverPathByEvent.has(row.event_id) && row.original_url) {
      coverPathByEvent.set(row.event_id, row.original_url);
    }
  }
  // Prefer the dedicated cover image (T-055) over the first photo. Overlaying
  // the map also covers events that have a cover but no photos yet.
  for (const [id, path] of coverOverride) coverPathByEvent.set(id, path);

  const coverUrlByEvent = new Map<string, string>();
  await Promise.all(
    Array.from(coverPathByEvent.entries()).map(async ([eventId, path]) => {
      const url = await createSignedUrl(supabaseAdmin, 'photos', path, SIGNED_URL_TTL);
      if (url) coverUrlByEvent.set(eventId, url);
    }),
  );

  const recentEvents: RecentEvent[] = recentEventSlice.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    city: e.city,
    country: e.country,
    activity: e.activity,
    isPublic: e.is_public,
    slug: e.slug,
    photoCount: photoCountByEvent.get(e.id) ?? 0,
    coverUrl: coverUrlByEvent.get(e.id) ?? null,
  }));

  const topEvent = topEvents[0] ?? null;

  return {
    metrics: {
      earningsCents: salesSummary.current.totalRevenueCents,
      sales: salesSummary.current.totalSales,
      photosUploaded: photosThisMonth,
      eventsCreated: eventsThisMonth,
      trend: {
        earningsPct: computePct(
          salesSummary.current.totalRevenueCents,
          salesSummary.previous.totalRevenueCents,
        ),
        salesPct: computePct(salesSummary.current.totalSales, salesSummary.previous.totalSales),
        photosPct: computePct(photosThisMonth, photosLastMonth),
        eventsPct: computePct(eventsThisMonth, eventsLastMonth),
      },
    },
    totals: {
      totalEvents: allEvents.length,
      totalPhotos: totalPhotosCountResult.count ?? 0,
    },
    storage: {
      usedGB: storageUsedGB,
      limitGB: storageLimitGB,
      usedPercent: storageUsedPercent,
    },
    topEvent: topEvent
      ? {
          event_id: topEvent.event_id,
          event_name: topEvent.event_name,
          event_date: topEvent.event_date,
          revenue_cents: topEvent.revenue_cents,
          photos_sold: topEvent.photos_sold,
        }
      : null,
    initialRange,
    initialSeries,
    recentSales,
    recentEvents,
  };
}

/**
 * Fetch cached analytics and storage data for the photographer dashboard overview.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  return getCachedDashboardData(user.id);
}

async function getCachedEarningsSeries(
  userId: string,
  range: DashboardRange,
): Promise<ChartPoint[]> {
  'use cache';
  cacheTag(`dashboard-chart-${userId}-${range}`);
  cacheLife('minutes');

  const window = rangeToDates(range);
  const rows = await getSalesOverTime(
    supabaseAdmin,
    userId,
    window.start,
    window.end,
    window.groupBy,
  );
  return rows.map((row) => ({ date: row.date, earnings: row.revenue_cents }));
}

/**
 * Fetch the earnings time-series for a given range. Used by the chart's
 * range toggle on the client.
 */
export async function getEarningsSeries(range: DashboardRange): Promise<ChartPoint[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  return getCachedEarningsSeries(user.id, range);
}
