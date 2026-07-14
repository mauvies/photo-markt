import { getFilterOptionsAction } from '@/app/[lang]/dashboard/talent/events/actions';
import { ExplorePageContent } from '@/app/[lang]/dashboard/talent/events/explore-page-content';
import {
  type PrefetchedEvents,
  prefetchInitialEvents,
} from '@/app/[lang]/dashboard/talent/events/prefetch-initial-events';
import { type EventStatus, getTodayISOString, getYesterdayISOString } from '@/lib/event-status';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

export default async function PublicEventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{
    where?: string;
    activity?: string;
    dateFrom?: string;
    dateTo?: string;
    preset?: string;
    status?: string;
    photographer?: string;
  }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const { where, activity, dateFrom, dateTo, preset, status, photographer } = await searchParams;
  const filterOptions = await getFilterOptionsAction();

  const validStatus: EventStatus | undefined =
    status === 'upcoming' || status === 'completed' ? status : undefined;

  // Map status to date filters so ExplorePageContent can use existing dateFrom/dateTo props
  const statusDateFrom = validStatus === 'upcoming' ? getTodayISOString() : undefined;
  const statusDateTo = validStatus === 'completed' ? getYesterdayISOString() : undefined;

  // Merge explicit date params with status-derived filters (status takes precedence)
  const effectiveDateFrom = validStatus ? statusDateFrom : dateFrom || undefined;
  const effectiveDateTo = validStatus ? statusDateTo : dateTo || undefined;

  // Pre-fetch events server-side so the client skips the duplicate POST on
  // mount. Only when a filter is in the URL — the unfiltered browse
  // experience lives on the home page (`/`), which T-124 already
  // server-renders via `EventsExploreView`.
  const { initialEvents, initialTotal }: PrefetchedEvents =
    where || validStatus
      ? await prefetchInitialEvents({
          filterOptions,
          where,
          activity,
          dateFrom: effectiveDateFrom,
          dateTo: effectiveDateTo,
          photographer,
        })
      : {};

  const searchKey = `${where ?? ''}-${activity ?? ''}-${dateFrom ?? ''}-${dateTo ?? ''}-${preset ?? ''}-${validStatus ?? ''}-${photographer ?? ''}`;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto max-w-[1400px] w-full flex-1 px-4 pt-6 pb-10">
        <TranslationsProvider
          translations={{ ...dict.eventFilterBar, ...dict.eventCard, activities: dict.activities }}
        >
          <ExplorePageContent
            key={searchKey}
            searchKey={searchKey}
            initialFilterOptions={filterOptions}
            initialEvents={initialEvents}
            initialTotal={initialTotal}
            eventLinkPrefix="/events"
            loadOnMount={!where && !validStatus}
            initialWhere={where}
            initialActivity={activity}
            initialDateFrom={effectiveDateFrom}
            initialDateTo={effectiveDateTo}
            initialPhotographerQuery={photographer}
            initialPreset={preset}
            hideTopFilters={true}
            showFindMe={false}
            eventSearchBarDict={dict.eventSearchBar}
          />
        </TranslationsProvider>
      </div>
    </div>
  );
}
