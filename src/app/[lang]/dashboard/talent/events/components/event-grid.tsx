'use client';

import { Filter, Loader2, Search } from 'lucide-react';
import { EventCard } from '@/components/event-card';
import { EventCardSkeleton } from '@/components/event-card-skeleton';
import { Button } from '@/components/ui/button';
import type { EventWithStats } from '@/hooks/use-event-search';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';

type EventGridT = Pick<
  Dictionary['eventFilterBar'],
  'searchPrompt' | 'noEventsFound' | 'noEventsFoundDesc' | 'clearFilters' | 'loadMore'
> &
  Pick<
    Dictionary['eventCard'],
    'photo' | 'photos' | 'noPhotosYet' | 'comingSoon' | 'imageUnavailable' | 'share'
  > & {
    activities: Dictionary['activities'];
  };

type EventGridProps = {
  events: EventWithStats[];
  isLoading: boolean;
  isInitialLoad: boolean;
  hasSearched: boolean;
  hasMore: boolean;
  skeletonKeys: string[];
  eventLinkPrefix?: string;
  onLoadMore: () => void;
};

// Mirrors the real EventCard (T-119/T-125/T-127) via the shared
// EventCardSkeleton, so the loading state never mismatches the loaded one
// (T-128) — see event-card-skeleton.tsx for the structure this reflects.
function EventSkeleton({ skeletonKeys }: { skeletonKeys: string[] }) {
  return (
    <div className="grid gap-5 sm:gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
      {skeletonKeys.map((key) => (
        <EventCardSkeleton key={key} />
      ))}
    </div>
  );
}

export function EventGrid({
  events,
  isLoading,
  isInitialLoad,
  hasSearched,
  hasMore,
  skeletonKeys,
  eventLinkPrefix,
  onLoadMore,
}: EventGridProps) {
  const { t } = useTranslations<EventGridT>();
  const activities = t('activities');

  if (!hasSearched) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{t('searchPrompt')}</p>
      </div>
    );
  }

  if ((isLoading || isInitialLoad) && events.length === 0) {
    return <EventSkeleton skeletonKeys={skeletonKeys} />;
  }

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <Filter className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <h3 className="mb-2 text-lg font-semibold">{t('noEventsFound')}</h3>
        <p className="text-sm text-muted-foreground">{t('noEventsFoundDesc')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-5 sm:gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
        {events.map((event, index) => (
          <EventCard
            key={event.id}
            id={event.id}
            hrefParam={event.slug ?? event.id}
            name={event.name}
            date={event.date}
            sessionTime={event.session_time}
            city={event.city}
            country={event.country}
            activity={event.activity}
            activityLabel={activities[event.activity as keyof typeof activities] ?? event.activity}
            photoCount={event.photoCount}
            coverUrl={event.coverUrl}
            coverThumbUrl={(event as { coverThumbUrl?: string | null }).coverThumbUrl}
            photographer={{
              username: event.photographerUsername,
              displayName: event.photographerDisplayName,
              avatarUrl: event.photographerAvatarUrl,
            }}
            status={event.status}
            linkPrefix={eventLinkPrefix}
            priority={index < 4}
            t={{
              photo: t('photo'),
              photos: t('photos'),
              noPhotosYet: t('noPhotosYet'),
              comingSoon: t('comingSoon'),
              imageUnavailable: t('imageUnavailable'),
              share: t('share'),
            }}
          />
        ))}
      </div>

      {hasMore && (
        <div className="mt-8 flex justify-center">
          <Button type="button" variant="outline" onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('loadMore')}
              </>
            ) : (
              t('loadMore')
            )}
          </Button>
        </div>
      )}
    </>
  );
}
