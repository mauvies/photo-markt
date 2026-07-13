import {
  getFilterOptionsAction,
  searchEventsAction,
} from '@/app/[lang]/dashboard/talent/events/actions';
import { ExplorePageContent } from '@/app/[lang]/dashboard/talent/events/explore-page-content';
import type { EventWithStats } from '@/hooks/use-event-search';
import {
  type EventStatus,
  getEventStatus,
  getTodayISOString,
  getYesterdayISOString,
} from '@/lib/event-status';
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

  // Pre-fetch events server-side so the client skips the duplicate POST on mount.
  // Only when location is known (i.e. `where` is in the URL); otherwise the client
  // handles geolocation and fetches on its own.
  let initialEvents: EventWithStats[] | undefined;
  let initialTotal: number | undefined;

  if (where || validStatus) {
    try {
      const matchedCity = filterOptions.cities.find(
        (c) => c.toLowerCase() === (where ?? '').toLowerCase(),
      );
      const matchedCountry = filterOptions.countries.find(
        (c) => c.toLowerCase() === (where ?? '').toLowerCase(),
      );

      const result = await searchEventsAction({
        searchText: matchedCity || matchedCountry ? undefined : where || undefined,
        activities: activity ? [activity] : undefined,
        cities: matchedCity ? [matchedCity] : undefined,
        countries: matchedCountry ? [matchedCountry] : undefined,
        dateFrom: effectiveDateFrom,
        dateTo: effectiveDateTo,
      });

      initialEvents = result.events.map((e) => ({
        ...e,
        pricePerPhoto: e.price_per_photo,
        status: getEventStatus(e.date),
      }));
      initialTotal = result.total;
    } catch {
      // fallback: client will fetch
    }
  }

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
