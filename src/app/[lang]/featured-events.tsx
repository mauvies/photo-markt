'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EventCard, type EventCardLabels } from '@/components/event-card';
import { EventSaveButton } from '@/components/event-save-button';
import { Button } from '@/components/ui/button';
import type { EventStatus } from '@/lib/event-status';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';
import { EventStatusToggle } from './event-status-toggle';
import type { TopEventItem } from './top-events-actions';

const DISPLAY_LIMIT = 4;

interface FeaturedEventsProps {
  /** Up to 4 upcoming + 4 completed events — filtered client-side below. */
  events: TopEventItem[];
  lang: string;
  activities: Dictionary['activities'];
  t: {
    title: string;
    exploreAllEvents: string;
    statusAll: string;
    statusUpcoming: string;
    statusCompleted: string;
    noEvents: string;
    card: EventCardLabels;
  };
}

/**
 * Featured-events section of the home page. The status filter lives in client
 * state (no `?status=` query param) so the home page stays statically
 * prerenderable — reading `searchParams` server-side would force it dynamic.
 */
export function FeaturedEvents({ events, lang, activities, t }: FeaturedEventsProps) {
  const [status, setStatus] = useState<EventStatus | undefined>(undefined);

  const visible = useMemo(() => {
    const upcoming = events.filter((e) => e.status === 'upcoming');
    const completed = events.filter((e) => e.status === 'completed');
    if (status === 'upcoming') return upcoming.slice(0, DISPLAY_LIMIT);
    if (status === 'completed') return completed.slice(0, DISPLAY_LIMIT);
    // "All" — up to 2 upcoming first, then fill to the limit with completed.
    const lead = upcoming.slice(0, 2);
    return [...lead, ...completed.slice(0, DISPLAY_LIMIT - lead.length)];
  }, [events, status]);

  if (events.length === 0) return null;

  const eventsHref = localizedPath(lang, '/events');

  return (
    <section className="bg-background py-16 sm:py-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h2>
          <div className="flex items-center gap-6">
            <EventStatusToggle
              value={status}
              onChange={setStatus}
              t={{ all: t.statusAll, upcoming: t.statusUpcoming, completed: t.statusCompleted }}
            />
            <Link href={eventsHref}>
              <Button variant="ghost" size="sm" className="hidden gap-1 xl:flex">
                {t.exploreAllEvents}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>

        {visible.length === 0 ? (
          /* An invisible real card sets the exact height of a populated tab, so
             the section never changes height when a status tab has no events.
             The message is overlaid on top, centered. */
          <div className="relative">
            <div aria-hidden className="pointer-events-none invisible">
              <div className="w-[80vw] sm:w-[45vw] xl:mx-auto xl:w-1/4">
                <EventCard
                  id={events[0].id}
                  hrefParam={events[0].slug ?? events[0].id}
                  name={events[0].name}
                  date={events[0].date}
                  city={events[0].city}
                  country={events[0].country}
                  activity={events[0].activity}
                  activityLabel={
                    activities[events[0].activity as keyof typeof activities] ?? events[0].activity
                  }
                  photoCount={events[0].photoCount}
                  coverUrl={events[0].coverUrl}
                  coverThumbUrl={events[0].coverThumbUrl}
                  photographer={{
                    username: events[0].photographerUsername,
                    displayName: events[0].photographerDisplayName,
                  }}
                  status={events[0].status}
                  linkPrefix={eventsHref}
                  t={t.card}
                />
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-border bg-background px-4 text-center">
              <p className="text-sm text-muted-foreground">{t.noEvents}</p>
            </div>
          </div>
        ) : (
          /* `touch-pan-x touch-pan-y`: the browser handles horizontal panning
             of this carousel AND vertical panning (page scroll) natively.
             `touch-pan-x` alone blocks vertical scroll for touches that
             start on a carousel item. */
          <div className="flex gap-4 overflow-x-auto overscroll-x-contain touch-pan-x touch-pan-y scroll-smooth snap-x snap-mandatory pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:grid xl:grid-cols-4 xl:overflow-visible xl:pb-0">
            {visible.map((event, index) => (
              <div
                key={event.id}
                className="w-[80vw] shrink-0 snap-start sm:w-[45vw] xl:w-auto xl:shrink"
              >
                <EventCard
                  id={event.id}
                  hrefParam={event.slug ?? event.id}
                  name={event.name}
                  date={event.date}
                  city={event.city}
                  country={event.country}
                  activity={event.activity}
                  activityLabel={
                    activities[event.activity as keyof typeof activities] ?? event.activity
                  }
                  photoCount={event.photoCount}
                  coverUrl={event.coverUrl}
                  coverThumbUrl={event.coverThumbUrl}
                  priority={index < DISPLAY_LIMIT}
                  photographer={{
                    username: event.photographerUsername,
                    displayName: event.photographerDisplayName,
                  }}
                  status={event.status}
                  linkPrefix={eventsHref}
                  saveSlot={<EventSaveButton eventId={event.id} />}
                  t={t.card}
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-center xl:hidden">
          <Link href={eventsHref}>
            <Button variant="outline" size="sm">
              {t.exploreAllEvents}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
