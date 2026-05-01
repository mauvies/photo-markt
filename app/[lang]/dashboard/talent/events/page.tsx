import { EventSearchBar } from '@/components/event-search-bar';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getFilterOptionsAction } from './actions';
import { ExplorePageContent } from './explore-page-content';

export default async function TalentExplorePage({
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
  const { where, activity, dateFrom, dateTo, preset } = await searchParams;

  const dict = await getDictionary(lang as Locale);
  const filterOptions = await getFilterOptionsAction();

  const key = `${where ?? ''}-${activity ?? ''}-${dateFrom ?? ''}-${dateTo ?? ''}`;

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <TranslationsProvider translations={dict.eventSearchBar}>
          <EventSearchBar
            key={key}
            variant="hero"
            initialWhere={where ?? ''}
            initialActivity={activity ?? ''}
            initialDateFrom={dateFrom ?? ''}
            initialDateTo={dateTo ?? ''}
            initialPreset={preset}
            searchHref="/dashboard/talent/events"
          />
        </TranslationsProvider>
      </div>

      <TranslationsProvider translations={{ ...dict.eventFilterBar, ...dict.eventCard }}>
        <ExplorePageContent
          key={key}
          initialFilterOptions={filterOptions}
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
  );
}
