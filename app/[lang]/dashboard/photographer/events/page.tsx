import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';
import { DashboardHeader } from '@/components/dashboard-header';
import { Button } from '@/components/ui/button';
import { createSignedUrl, getPhotosForEvents, getUserEvents } from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { deleteEventAction as deleteEvent } from './actions';
import { EventCard } from './event-card';

type PhotoStat = {
  count: number;
  coverPath: string | null;
  firstTakenAt: string | null;
  lastTakenAt: string | null;
};

// Sign URLs for 55 min so they never expire within the 50-min cache window
const SIGNED_URL_TTL = 60 * 55;

async function getCachedEventsData(userId: string): Promise<{
  events: Awaited<ReturnType<typeof getUserEvents>>;
  stats: Map<string, PhotoStat>;
  salesCounts: Map<string, number>;
  coverUrls: Map<string, string>;
}> {
  'use cache';
  cacheTag(`photographer-events-${userId}`);
  cacheLife({ revalidate: 60 * 50 });

  const events = await getUserEvents(supabaseAdmin, userId);
  const eventIds = events.map((e) => e.id).filter(Boolean);

  const empty = {
    events,
    stats: new Map<string, PhotoStat>(),
    salesCounts: new Map<string, number>(),
    coverUrls: new Map<string, string>(),
  };
  if (eventIds.length === 0) return empty;

  const [photoRows, salesData] = await Promise.all([
    getPhotosForEvents(supabaseAdmin, eventIds),
    supabaseAdmin
      .from('order_items')
      .select('photo_id, orders!inner(id, status), photos!inner(event_id)')
      .eq('photographer_id', userId)
      .eq('orders.status', 'completed')
      .in('photos.event_id', eventIds),
  ]);

  const stats = new Map<string, PhotoStat>();

  (photoRows ?? []).forEach((row) => {
    if (!row.event_id) return;
    const current = stats.get(row.event_id) ?? {
      count: 0,
      coverPath: null,
      firstTakenAt: null,
      lastTakenAt: null,
    };
    current.count += 1;
    if (!current.coverPath && row.original_url) {
      current.coverPath = row.original_url;
    }
    if (row.taken_at) {
      if (!current.firstTakenAt) current.firstTakenAt = row.taken_at;
      current.lastTakenAt = row.taken_at;
    }
    stats.set(row.event_id, current);
  });

  events.forEach((event) => {
    if (!stats.has(event.id)) {
      stats.set(event.id, { count: 0, coverPath: null, firstTakenAt: null, lastTakenAt: null });
    }
  });

  const uniqueOrdersPerEvent = new Map<string, Set<string>>();
  const items = (salesData.data ?? []) as Array<{
    photos: Array<{ event_id: string | null }> | { event_id: string | null };
    orders: Array<{ id: string }> | { id: string };
  }>;
  items.forEach((item) => {
    const photo = Array.isArray(item.photos) ? item.photos[0] : item.photos;
    const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
    if (!photo?.event_id || !order?.id) return;
    const orderSet = uniqueOrdersPerEvent.get(photo.event_id) ?? new Set<string>();
    orderSet.add(order.id);
    uniqueOrdersPerEvent.set(photo.event_id, orderSet);
  });

  const salesCounts = new Map<string, number>();
  uniqueOrdersPerEvent.forEach((orderSet, eventId) => {
    salesCounts.set(eventId, orderSet.size);
  });

  // Sign cover URLs inside the cache so repeated navigations skip this entirely
  const coverUrls = new Map<string, string>();
  await Promise.all(
    Array.from(stats.entries()).map(async ([eventId, info]) => {
      if (!info.coverPath) return;
      const url = await createSignedUrl(supabaseAdmin, 'photos', info.coverPath, SIGNED_URL_TTL);
      if (url) coverUrls.set(eventId, url);
    }),
  );

  return { events, stats, salesCounts, coverUrls };
}

export default async function EventsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div>
        <DashboardHeader title={dict.photographerDashboard.overview} />
        <p className="mt-2 text-muted-foreground">{dict.photographerDashboard.pleaseSignIn}</p>
      </div>
    );
  }

  const { events, stats, salesCounts, coverUrls } = await getCachedEventsData(user.id);

  return (
    <div>
      <DashboardHeader title={dict.dashboard.events} />
      {events.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <div className="mb-4 rounded-full bg-muted p-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">{dict.photographerDashboard.noEventsYet}</h3>
          <p className="mt-2 mb-6 max-w-sm text-sm text-muted-foreground">
            {dict.photographerDashboard.noEventsYetDesc}
          </p>
          <Link href={`/${lang}/dashboard/photographer/events/new`}>
            <Button>{dict.photographerDashboard.createFirstEvent}</Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            {`${events.length} event${events.length === 1 ? '' : 's'}`}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {events.map((event) => {
              const stat = stats.get(event.id) ?? {
                count: 0,
                coverPath: null,
                firstTakenAt: null,
                lastTakenAt: null,
              };
              const count = stat.count;
              const coverUrl = coverUrls.get(event.id);

              return (
                <EventCard
                  key={event.id}
                  id={event.id}
                  name={event.name}
                  date={event.date}
                  city={event.city}
                  country={event.country}
                  activity={event.activity}
                  pricePerPhoto={event.price_per_photo}
                  photoCount={count}
                  salesCount={salesCounts.get(event.id) ?? 0}
                  isPublic={event.is_public}
                  coverUrl={coverUrl}
                  editHref={`/dashboard/photographer/events/${event.id}/edit`}
                  onDelete={deleteEvent.bind(null, event.id)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
