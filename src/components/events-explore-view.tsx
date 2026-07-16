import { ExplorePageContent } from '@/app/[lang]/dashboard/talent/events/explore-page-content';
import { prefetchInitialEvents } from '@/app/[lang]/dashboard/talent/events/prefetch-initial-events';
import { EventSearchBar } from '@/components/event-search-bar';
import type { FilterOptions } from '@/hooks/use-event-search';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

export type EventsExploreSearchParams = {
  where?: string;
  activity?: string;
  dateFrom?: string;
  dateTo?: string;
  preset?: string;
  photographer?: string;
};

/**
 * Shared browse-events experience rendered identically by the public home page
 * (`/`) and the talent dashboard explore page (`/dashboard/talent/events`). The
 * two only differ in their surrounding header — the public `Nav` self-hides on
 * `/dashboard`, and the talent layout injects `TalentDashboardHeader`. So this
 * component owns the whole body: hero + search bar + paginated events grid.
 *
 * `basePath` drives where the search bar navigates on submit (query params →
 * remount via `key` → `useEventSearch` refetch). `eventLinkPrefix` drives where
 * event cards and access codes resolve (public viewer vs dashboard wrapper).
 */
export async function EventsExploreView({
  dict,
  filterOptions,
  searchParams,
  basePath,
  eventLinkPrefix,
}: {
  dict: Dictionary;
  filterOptions: FilterOptions;
  searchParams: EventsExploreSearchParams;
  basePath: string;
  eventLinkPrefix: string;
}) {
  const { where, activity, dateFrom, dateTo, preset, photographer } = searchParams;

  // T-124: server-render the first events page so the grid (and its
  // `priority` cover images) travels in the initial HTML instead of waiting
  // for hydration + a search-action POST (LCP driver #1 in T-123's audit).
  // Ordering decision: SSR serves the default order (`date_desc`) — there is
  // no geolocation-based "nearby first" path in the codebase today (nothing
  // calls `navigator.geolocation`; `useEventSearch` merely accepts lat/lng),
  // so this matches what the client fetch produced. If nearby-first lands
  // later, it should re-order client-side after this seeded first paint.
  const { initialEvents, initialTotal } = await prefetchInitialEvents({
    filterOptions,
    where,
    activity,
    dateFrom,
    dateTo,
    photographer,
  });

  // Any filter change remounts the search bar + explore content so the initial
  // values (and the query key inside useEventSearch) reflect the new URL.
  const key = `${where ?? ''}-${activity ?? ''}-${dateFrom ?? ''}-${dateTo ?? ''}-${preset ?? ''}-${photographer ?? ''}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* Hero — horizontal padding comes from the parent container (the home
          page wrapper / the talent dashboard layout) so both pages line up. */}
        <section className="relative flex flex-col items-center justify-center overflow-hidden pb-2">
          <div className="relative z-10 mx-auto max-w-5xl text-center">
            <h1 className="text-balance text-4xl font-bold sm:text-5xl">
              <span className="block bg-linear-to-r from-primary via-primary/80 to-primary/60 bg-clip-text pt-4 sm:pt-0 pb-2 text-transparent">
                {dict.home.heroHeadline1} {dict.home.heroHeadline2}
              </span>
            </h1>
            <p className="text-md mx-auto max-w-5xl leading-normal text-muted-foreground sm:text-lg">
              {dict.home.heroSubtitle}
            </p>
          </div>
        </section>

        <div className="flex justify-center">
          <TranslationsProvider translations={dict.eventSearchBar}>
            <EventSearchBar
              key={key}
              variant="hero"
              className="mx-auto"
              initialWhere={where ?? ''}
              initialActivity={activity ?? ''}
              initialDateFrom={dateFrom ?? ''}
              initialDateTo={dateTo ?? ''}
              initialPreset={preset}
              initialPhotographer={photographer ?? ''}
              searchHref={basePath}
              accessCodeHref={eventLinkPrefix}
            />
          </TranslationsProvider>
        </div>
      </div>

      <TranslationsProvider
        translations={{ ...dict.eventFilterBar, ...dict.eventCard, activities: dict.activities }}
      >
        <ExplorePageContent
          key={key}
          initialFilterOptions={filterOptions}
          initialEvents={initialEvents}
          initialTotal={initialTotal}
          // Fallback only: with `initialEvents` seeded the query renders from
          // cache without a mount POST; if the prefetch failed the client
          // fetches on mount exactly as before T-124.
          loadOnMount={true}
          hideTopFilters={true}
          showFindMe={false}
          initialWhere={where}
          initialActivity={activity}
          initialDateFrom={dateFrom}
          initialDateTo={dateTo}
          initialPhotographerQuery={photographer}
          initialPreset={preset}
          eventLinkPrefix={eventLinkPrefix}
          gridHeading={dict.home.featuredEventsTitle}
        />
      </TranslationsProvider>
    </div>
  );
}
