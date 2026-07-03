import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';
import { DashboardHeader } from '@/components/dashboard-header';
import { EventCard } from '@/components/event-card';
import { Button } from '@/components/ui/button';
import {
  createSignedUrl,
  getEventsCoverPaths,
  getPendingInvitationsForPhotographer,
  getPhotoCountsForEvents,
  getPhotosForEvents,
  getUserEvents,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getEventStatus } from '@/lib/event-status';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getUsageStats } from '@/lib/plan-limits';
import { deleteEventAction as deleteEvent } from './actions';
import { EventCardActions } from './event-card-actions';
import { EventLimitReachedDialog } from './event-limit-reached-dialog';
import { PendingInvitationsPanel } from './pending-invitations-panel';

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
    coverUrls: new Map<string, string>(),
  };
  if (eventIds.length === 0) return empty;

  // Fetch total counts (pending+approved), cover candidates (approved-only),
  // and explicit cover overrides in parallel. The count uses all non-rejected
  // statuses so the card number is stable from upload and doesn't grow as the
  // Inngest worker promotes photos; cover selection stays approved-only so we
  // always serve a displayable image.
  const [totalCounts, photoRows, coverOverride] = await Promise.all([
    getPhotoCountsForEvents(supabaseAdmin, eventIds),
    getPhotosForEvents(supabaseAdmin, eventIds),
    getEventsCoverPaths(supabaseAdmin, eventIds),
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
    if (!current.coverPath && row.original_url) {
      current.coverPath = row.original_url;
    }
    if (row.taken_at) {
      if (!current.firstTakenAt) current.firstTakenAt = row.taken_at;
      current.lastTakenAt = row.taken_at;
    }
    stats.set(row.event_id, current);
  });

  // Apply total counts (stable from upload).
  for (const [eventId, total] of totalCounts) {
    const current = stats.get(eventId) ?? {
      count: 0,
      coverPath: null,
      firstTakenAt: null,
      lastTakenAt: null,
    };
    current.count = total;
    stats.set(eventId, current);
  }

  events.forEach((event) => {
    if (!stats.has(event.id)) {
      stats.set(event.id, { count: 0, coverPath: null, firstTakenAt: null, lastTakenAt: null });
    }
  });

  // Prefer the dedicated cover image (T-055) over the first photo.
  for (const [id, path] of coverOverride) {
    const current = stats.get(id);
    if (current) current.coverPath = path;
    else stats.set(id, { count: 0, coverPath: path, firstTakenAt: null, lastTakenAt: null });
  }

  // Sign cover URLs inside the cache so repeated navigations skip this entirely
  const coverUrls = new Map<string, string>();
  await Promise.all(
    Array.from(stats.entries()).map(async ([eventId, info]) => {
      if (!info.coverPath) return;
      const url = await createSignedUrl(supabaseAdmin, 'photos', info.coverPath, SIGNED_URL_TTL);
      if (url) coverUrls.set(eventId, url);
    }),
  );

  return { events, stats, coverUrls };
}

export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ limit?: string }>;
}) {
  const { lang } = await params;
  const { limit } = await searchParams;
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

  const [{ events, stats, coverUrls }, pendingInvitations, usageStats] = await Promise.all([
    getCachedEventsData(user.id),
    getPendingInvitationsForPhotographer(supabase, user.id),
    limit === 'events' ? getUsageStats(supabase, user.id) : Promise.resolve(null),
  ]);

  return (
    <div>
      {limit === 'events' && usageStats && usageStats.eventsLimit !== null && (
        <EventLimitReachedDialog
          current={usageStats.eventsCount}
          max={usageStats.eventsLimit}
          planName={dict.plans[usageStats.planId]}
          upgradeHref={`/${lang}/dashboard/photographer/settings?tab=billing`}
          t={{
            title: dict.photographerDashboard.eventLimitDialogTitle,
            body: dict.photographerDashboard.eventLimitDialogBody,
            upgradeCta: dict.photographerDashboard.upgradeCta,
            closeLabel: dict.common.close,
          }}
        />
      )}
      <DashboardHeader title={dict.dashboard.events} />
      <TranslationsProvider translations={dict.organizerEvent}>
        <PendingInvitationsPanel initialInvitations={pendingInvitations} />
      </TranslationsProvider>
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
          <p className="mt-2 mb-6 max-w-sm text-base text-muted-foreground md:text-sm">
            {dict.photographerDashboard.noEventsYetDesc}
          </p>
          <Link href={`/${lang}/dashboard/photographer/events/new`}>
            <Button>{dict.photographerDashboard.createFirstEvent}</Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="text-base text-muted-foreground md:text-sm">
            {`${events.length} event${events.length === 1 ? '' : 's'}`}
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {events.map((event, index) => {
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
                  linkPrefix={`/${lang}/dashboard/photographer/events`}
                  name={event.name}
                  date={event.date}
                  city={event.city}
                  country={event.country}
                  activity={event.activity}
                  activityLabel={
                    dict.activities[event.activity as keyof typeof dict.activities] ??
                    event.activity
                  }
                  photoCount={count}
                  coverUrl={coverUrl}
                  status={event.date ? getEventStatus(event.date) : undefined}
                  priority={index < 4}
                  ownerStats={{
                    isPublic: event.is_public,
                    privateLabel: dict.eventCard.privateEvent,
                  }}
                  t={{
                    photo: dict.events.photo,
                    photos: dict.events.photos,
                    noPhotosYet: dict.events.noPhotosYet,
                    upcomingLabel: dict.events.statusUpcoming,
                    imageUnavailable: dict.eventCard.imageUnavailable,
                  }}
                  actions={
                    <EventCardActions
                      editHref={`/dashboard/photographer/events/${event.id}/edit`}
                      onDelete={deleteEvent.bind(null, event.id)}
                      labels={{
                        edit: dict.events.editEvent,
                        delete: dict.events.deleteEvent,
                        deleteTitle: dict.events.deleteConfirmTitle,
                        deleteDescription: dict.events.deleteConfirmDesc,
                        deleteConfirm: dict.events.confirmButton,
                        deleteCancel: dict.events.cancelButton,
                        ariaOpen: dict.events.eventActionsMenuLabel,
                        moreOptions: dict.eventCard.moreOptions,
                      }}
                    />
                  }
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
