import type { Metadata } from 'next';
import { getFilterOptionsAction } from '@/app/[lang]/dashboard/talent/events/actions';
import { EventsExploreView } from '@/components/events-explore-view';
import { getUser } from '@/database/server';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';

/**
 * `/events` is an **alias of the home explore experience** (T-157), not a
 * separate surface:
 *
 * - **Anonymous / crawler:** renders the exact same `EventsExploreView` the
 *   home (`/[lang]`) renders — hero + search + "Latest events" + grid. The
 *   search bar keeps `basePath` on `/events` so searching stays on this URL.
 * - **Authenticated:** redirected to the logged-in explore surface
 *   (`/dashboard/talent/events`).
 * - **SEO:** `generateMetadata` sets `rel=canonical` → the home (`/[lang]`) so
 *   Google consolidates the signal there instead of treating this as duplicate
 *   content. `/events` is intentionally dropped from the sitemap (non-canonical
 *   URLs aren't listed); the per-event `/events/<slug>` detail pages are the
 *   real indexed surface and are untouched.
 *
 * The `?status=` filter the old listing supported was removed — nothing linked
 * to it and the home never exposed it.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const siteUrl = getSiteUrl();
  // Canonical points at the home — /events is a mirror, not its own page.
  return {
    alternates: {
      canonical: `${siteUrl}/${lang}`,
      languages: {
        es: `${siteUrl}/es`,
        en: `${siteUrl}/en`,
        'x-default': `${siteUrl}/es`,
      },
    },
  };
}

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
    photographer?: string;
  }>;
}) {
  const { lang } = await params;

  // Logged-in users get their dashboard's explore surface; /events is the
  // anonymous/crawler mirror. Checked before any data fetch so authed hits
  // never do the prefetch work.
  const user = await getUser();
  if (user) {
    localizedRedirect(lang, '/dashboard/talent/events');
  }

  const [dict, filterOptions, resolvedSearchParams] = await Promise.all([
    getDictionary(lang as Locale),
    getFilterOptionsAction(),
    searchParams,
  ]);

  // Same wrapper + shared view as the home page so the two are pixel-identical.
  // `basePath` stays on /events so a search from here doesn't bounce the user
  // to the home; cards resolve to the public `/events/<code>` detail route.
  return (
    <div className="mx-auto w-full max-w-[1300px] px-3 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8">
      <EventsExploreView
        dict={dict}
        filterOptions={filterOptions}
        searchParams={resolvedSearchParams}
        basePath={`/${lang}/events`}
        eventLinkPrefix={`/${lang}/events`}
      />
    </div>
  );
}
