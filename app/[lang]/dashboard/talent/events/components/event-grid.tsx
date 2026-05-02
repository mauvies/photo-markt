'use client';

import { Filter, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EventWithStats } from '@/hooks/use-event-search';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { ExploreEventCard } from '../explore-event-card';

type EventGridT = Pick<
  Dictionary['eventFilterBar'],
  'searchPrompt' | 'noEventsFound' | 'noEventsFoundDesc' | 'clearFilters' | 'loadMore'
> &
  Pick<
    Dictionary['eventCard'],
    'photo' | 'photos' | 'from' | 'free' | 'noPhotosYet' | 'comingSoon'
  >;

type EventGridProps = {
  events: EventWithStats[];
  isLoading: boolean;
  isInitialLoad: boolean;
  hasSearched: boolean;
  hasMore: boolean;
  hasFilters: boolean;
  skeletonKeys: string[];
  eventLinkPrefix?: string;
  onLoadMore: () => void;
  onClearFilters: () => void;
};

function EventSkeleton({ skeletonKeys }: { skeletonKeys: string[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {skeletonKeys.map((key) => (
        <div key={key} className="group block">
          {/* Match ExploreEventCard spacing/layout */}
          <div className="relative mb-3 aspect-square w-full overflow-hidden rounded-xl bg-muted">
            <div className="absolute inset-0 animate-pulse bg-muted" />
            <div className="absolute inset-0 bg-linear-to-t from-black/10 via-transparent to-transparent" />
            <div className="absolute bottom-0 left-0 p-3">
              <div className="h-3 w-16 animate-pulse rounded bg-white/30" />
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 px-1">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>

            <div className="shrink-0 text-right space-y-2">
              <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-10 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
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
  hasFilters,
  skeletonKeys,
  eventLinkPrefix,
  onLoadMore,
  onClearFilters,
}: EventGridProps) {
  const { t } = useTranslations<EventGridT>();

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
        {hasFilters && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearFilters}
            className="mt-4"
          >
            {t('clearFilters')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {events.map((event) => (
          <ExploreEventCard
            key={event.id}
            id={event.id}
            hrefParam={event.slug ?? event.id}
            name={event.name}
            date={event.date}
            city={event.city}
            country={event.country}
            activity={event.activity}
            photoCount={event.photoCount}
            coverUrl={event.coverUrl}
            pricePerPhoto={event.pricePerPhoto}
            photographerUsername={event.photographerUsername}
            photographerDisplayName={event.photographerDisplayName}
            status={event.status}
            linkPrefix={eventLinkPrefix}
            t={{
              photo: t('photo'),
              photos: t('photos'),
              from: t('from'),
              free: t('free'),
              noPhotosYet: t('noPhotosYet'),
              comingSoon: t('comingSoon'),
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
