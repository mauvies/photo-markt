import { cacheLife, cacheTag } from 'next/cache';
import { getFilterOptionsAction } from '@/app/[lang]/dashboard/talent/events/actions';
import { ExplorePageContent } from '@/app/[lang]/dashboard/talent/events/explore-page-content';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

async function getCachedDictionary(lang: string) {
  'use cache';
  cacheTag(`dict-${lang}`);
  cacheLife('max');
  return getDictionary(lang as Locale);
}

// T-118: `/` is the unified home — it serves the public landing AND an
// authenticated talent's home/explore page (the header adapts to auth state;
// see `Nav`). No `searchParams` here so the page stays statically
// prerendered per locale — a shareable filtered search lives at `/events`,
// which reuses the same `ExplorePageContent`.
export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;

  const [dict, filterOptions] = await Promise.all([
    getCachedDictionary(lang),
    getFilterOptionsAction(),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      {/* Compact hero — title only, no subtitle, no full-viewport height. */}
      <section className="relative overflow-hidden bg-linear-to-br from-background via-background to-primary/5 py-10 sm:py-14">
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-1/4 top-1/4 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute right-1/4 bottom-1/4 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="relative z-10 mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-balance text-3xl font-bold sm:text-4xl lg:text-5xl">
            {dict.home.heroHeadline1}
            <span className="block bg-linear-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent pb-1">
              {dict.home.heroHeadline2}
            </span>
          </h1>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-10 sm:px-6 lg:px-8">
        <TranslationsProvider
          translations={{ ...dict.eventFilterBar, ...dict.eventCard, activities: dict.activities }}
        >
          <ExplorePageContent
            initialFilterOptions={filterOptions}
            loadOnMount
            eventLinkPrefix="/events"
            hideTopFilters
            showFindMe={false}
            eventSearchBarDict={dict.eventSearchBar}
          />
        </TranslationsProvider>
      </div>
    </div>
  );
}
