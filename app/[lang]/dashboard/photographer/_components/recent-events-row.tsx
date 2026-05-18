import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { EventCard, type EventCardLabels } from '@/components/event-card';
import { getEventStatus } from '@/lib/event-status';
import type { RecentEvent } from '../actions';
import { NoEventsEmpty } from './empty-states';

interface RecentEventsRowProps {
  events: RecentEvent[];
  lang: string;
  /** Localized activity dictionary, keyed by activity slug. */
  activityLabels: Record<string, string>;
  eventCardLabels: EventCardLabels & { privateEvent: string };
  t: {
    title: string;
    viewAll: string;
    emptyTitle: string;
    emptyBody: string;
    emptyCta: string;
  };
}

export function RecentEventsRow({
  events,
  lang,
  activityLabels,
  eventCardLabels,
  t,
}: RecentEventsRowProps) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <header className="mb-3 flex items-center justify-between sm:mb-4">
        <h2 className="text-base font-semibold sm:text-lg">{t.title}</h2>
        <Link
          href={`/${lang}/dashboard/photographer/events`}
          className="hidden items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
        >
          {t.viewAll}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </header>

      {events.length === 0 ? (
        <NoEventsEmpty
          lang={lang}
          t={{ title: t.emptyTitle, body: t.emptyBody, ctaLabel: t.emptyCta }}
        />
      ) : (
        <>
          <div className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0 xl:grid-cols-5">
            {events.map((event, index) => (
              <div
                key={event.id}
                className="w-[75vw] shrink-0 snap-start sm:w-[45vw] lg:w-auto lg:shrink"
              >
                <EventCard
                  id={event.id}
                  linkPrefix={`/${lang}/dashboard/photographer/events`}
                  name={event.name}
                  date={event.date}
                  city={event.city}
                  country={event.country}
                  activity={event.activity}
                  activityLabel={activityLabels[event.activity] ?? event.activity}
                  photoCount={event.photoCount}
                  coverUrl={event.coverUrl}
                  status={event.date ? getEventStatus(event.date) : undefined}
                  priority={index < 2}
                  ownerStats={{
                    isPublic: event.isPublic,
                    privateLabel: eventCardLabels.privateEvent,
                  }}
                  t={eventCardLabels}
                />
              </div>
            ))}
          </div>
          <Link
            href={`/${lang}/dashboard/photographer/events`}
            className="mt-3 flex items-center justify-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:hidden"
          >
            {t.viewAll}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </>
      )}
    </section>
  );
}
