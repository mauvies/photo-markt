import { EventsExploreView } from '@/components/events-explore-view';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getFilterOptionsAction } from './actions';

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
    photographer?: string;
  }>;
}) {
  const { lang } = await params;
  const [dict, filterOptions, resolvedSearchParams] = await Promise.all([
    getDictionary(lang as Locale),
    getFilterOptionsAction(),
    searchParams,
  ]);

  // Identical browse-events view to the public home page — only the header
  // differs (this page renders inside the talent dashboard chrome). Event
  // cards and access codes stay inside the dashboard (`/dashboard/talent/events/<code>`).
  return (
    <EventsExploreView
      dict={dict}
      filterOptions={filterOptions}
      searchParams={resolvedSearchParams}
      basePath="/dashboard/talent/events"
      eventLinkPrefix="/dashboard/talent/events"
    />
  );
}
