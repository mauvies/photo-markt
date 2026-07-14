'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { listSavedEvents, type SavedEventCard } from '@/app/[lang]/actions/saved-events';
import { EventCard, type EventCardLabels } from '@/components/event-card';
import { Button } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';

const PAGE_SIZE = 12;

export type SavedEventsGridLabels = {
  emptyTitle: string;
  emptyBody: string;
  loadMore: string;
  loading: string;
};

type SavedEventsGridProps = {
  initialEvents: SavedEventCard[];
  initialHasMore: boolean;
  eventLinkPrefix: string;
  activities: Dictionary['activities'];
  cardLabels: EventCardLabels;
  labels: SavedEventsGridLabels;
};

/**
 * Saved-events list for the Favorites → Events tab. Reuses the shared EventCard
 * (not forked) with the same save button used elsewhere — unsaving optimistically
 * drops the card. "Load more" mirrors the events-listing pagination (12/page).
 */
export function SavedEventsGrid({
  initialEvents,
  initialHasMore,
  eventLinkPrefix,
  activities,
  cardLabels,
  labels,
}: SavedEventsGridProps) {
  const [events, setEvents] = useState(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [offset, setOffset] = useState(initialEvents.length);
  const [isLoading, startTransition] = useTransition();

  const handleRemove = (eventId: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    setOffset((prev) => Math.max(0, prev - 1));
  };

  const handleLoadMore = () => {
    startTransition(async () => {
      try {
        const result = await listSavedEvents({ limit: PAGE_SIZE, offset });
        setEvents((prev) => [...prev, ...result.events]);
        setOffset((prev) => prev + result.events.length);
        setHasMore(result.hasMore);
      } catch (error) {
        console.error('Failed to load more saved events:', error);
      }
    });
  };

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center">
        <p className="font-medium text-foreground">{labels.emptyTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{labels.emptyBody}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
        {events.map((event, index) => (
          <EventCard
            key={event.id}
            id={event.id}
            hrefParam={event.slug ?? event.id}
            name={event.name}
            date={event.date}
            city={event.city}
            country={event.country}
            activity={event.activity}
            activityLabel={activities[event.activity as keyof typeof activities] ?? event.activity}
            photoCount={event.photoCount}
            coverUrl={event.coverUrl}
            photographer={{
              username: event.photographerUsername,
              displayName: event.photographerDisplayName,
            }}
            status={event.status}
            linkPrefix={eventLinkPrefix}
            priority={index < 4}
            onSaveToggled={(saved) => {
              if (!saved) handleRemove(event.id);
            }}
            t={cardLabels}
          />
        ))}
      </div>

      {hasMore && (
        <div className="mt-8 flex justify-center">
          <Button type="button" variant="outline" onClick={handleLoadMore} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {labels.loading}
              </>
            ) : (
              labels.loadMore
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
