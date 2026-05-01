import {
  getFilterOptionsAction,
  searchEventsAction,
} from '@/app/[lang]/dashboard/talent/events/actions';
import { ExplorePageContent } from '@/app/[lang]/dashboard/talent/events/explore-page-content';
import { EventSearchBar } from '@/components/event-search-bar';
import { Footer } from '@/components/footer';
import type { EventWithStats } from '@/hooks/use-event-search';
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
  }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const { where, activity, dateFrom, dateTo, preset } = await searchParams;
  const filterOptions = await getFilterOptionsAction();

  // Pre-fetch events server-side so the client skips the duplicate POST on mount.
  // Only when location is known (i.e. `where` is in the URL); otherwise the client
  // handles geolocation and fetches on its own.
  let initialEvents: EventWithStats[] | undefined;
  let initialTotal: number | undefined;

  if (where) {
    try {
      // Replicate the hook's logic: exact city/country match → filter; otherwise → searchText
      const matchedCity = filterOptions.cities.find((c) => c.toLowerCase() === where.toLowerCase());
      const matchedCountry = filterOptions.countries.find(
        (c) => c.toLowerCase() === where.toLowerCase(),
      );

      const result = await searchEventsAction({
        searchText: matchedCity || matchedCountry ? undefined : where,
        activities: activity ? [activity] : undefined,
        cities: matchedCity ? [matchedCity] : undefined,
        countries: matchedCountry ? [matchedCountry] : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });

      initialEvents = result.events.map((e) => ({
        ...e,
        pricePerPhoto: e.price_per_photo,
      }));
      initialTotal = result.total;
    } catch {
      // fallback: client will fetch
    }
  }

  const searchKey = `${where ?? ''}-${activity ?? ''}-${dateFrom ?? ''}-${dateTo ?? ''}-${preset ?? ''}`;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <div className="mx-auto max-w-7xl w-full px-4 pt-6 pb-2">
        <div className="flex justify-center">
          <TranslationsProvider translations={dict.eventSearchBar}>
            <EventSearchBar
              key={searchKey}
              variant="hero"
              initialWhere={where ?? ''}
              initialActivity={activity ?? ''}
              initialDateFrom={dateFrom ?? ''}
              initialDateTo={dateTo ?? ''}
              initialPreset={preset}
            />
          </TranslationsProvider>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl w-full flex-1 px-4 pt-6 pb-10">
        <TranslationsProvider translations={{ ...dict.eventFilterBar, ...dict.eventCard }}>
          <ExplorePageContent
            key={searchKey}
            initialFilterOptions={filterOptions}
            initialEvents={initialEvents}
            initialTotal={initialTotal}
            eventLinkPrefix="/events"
            loadOnMount={true}
            initialWhere={where}
            initialActivity={activity}
            initialDateFrom={dateFrom}
            initialDateTo={dateTo}
            hideTopFilters={true}
            showFindMe={false}
          />
        </TranslationsProvider>
      </div>
      <Footer dict={dict} lang={lang} />
    </div>
  );
}
