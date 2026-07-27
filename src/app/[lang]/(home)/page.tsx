import { cacheLife, cacheTag } from 'next/cache';
import { EventsExploreView } from '@/components/events-explore-view';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getFilterOptionsAction } from '../dashboard/talent/events/actions';

async function getCachedDictionary(lang: string) {
  'use cache';
  cacheTag(`dict-${lang}`);
  cacheLife('max');
  return getDictionary(lang as Locale);
}

export default async function Home({
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
    getCachedDictionary(lang),
    getFilterOptionsAction(),
    searchParams,
  ]);

  // The home page shares the exact browse-events view with the talent dashboard
  // explore page — only the surrounding header differs (public Nav vs
  // TalentDashboardHeader). Event cards and access codes resolve to the public
  // viewer here (`/events/<code>`).
  return (
    <div className="mx-auto w-full max-w-[1300px] px-3 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8">
      <EventsExploreView
        dict={dict}
        filterOptions={filterOptions}
        searchParams={resolvedSearchParams}
        basePath={`/${lang}`}
        eventLinkPrefix={`/${lang}/events`}
      />
    </div>
  );
}
