import { ArrowRight, Camera, Download, Sparkles } from 'lucide-react';
import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ExploreEventCard } from '@/app/[lang]/dashboard/talent/events/explore-event-card';
import { EventSearchBar } from '@/components/event-search-bar';
import { Footer } from '@/components/footer';
import { HomeAuthRedirect } from '@/components/home-auth-redirect';
import { PricingSection } from '@/components/pricing-section';
import { Button } from '@/components/ui/button';
import type { EventStatus } from '@/lib/event-status';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { EventStatusToggle } from './event-status-toggle';
import { getCachedTopEvents } from './top-events-actions';

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
  searchParams: Promise<Record<string, string>>;
}) {
  const { lang } = await params;
  const sp = await searchParams;

  // Supabase may redirect back here instead of /auth/callback when the callback
  // URL isn't in the allowed redirect list. Forward to the real handler.
  if (sp.code) {
    const qs = new URLSearchParams(sp).toString();
    redirect(`/auth/callback?${qs}`);
  }

  const validStatus: EventStatus | undefined =
    sp.status === 'upcoming' || sp.status === 'completed' ? sp.status : undefined;

  const [dict, topEvents] = await Promise.all([
    getCachedDictionary(lang),
    getCachedTopEvents(validStatus),
  ]);
  const isAuthenticated = false;

  return (
    <div className="flex min-h-svh flex-col">
      <HomeAuthRedirect lang={lang} />
      {/* Hero Section */}
      <section className="relative flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center overflow-hidden bg-linear-to-br from-background via-background to-primary/5">
        {/* Decorative background */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-1/4 top-1/4 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute right-1/4 bottom-1/4 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="relative z-10 max-w-5xl text-center space-y-4 px-4 sm:px-6 lg:px-8">
          <h1 className="text-balance text-5xl font-bold sm:text-6xl lg:text-[5rem]">
            {dict.home.heroHeadline1}
            <span className="block bg-linear-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent pb-2">
              {dict.home.heroHeadline2}
            </span>
          </h1>

          <p className="mx-auto max-w-2xl text-lg leading-normal text-muted-foreground sm:text-xl">
            {dict.home.heroSubtitle}
          </p>

          <TranslationsProvider translations={dict.eventSearchBar}>
            <EventSearchBar variant="hero" className="mx-auto" />
          </TranslationsProvider>

          <p className="text-xs text-muted-foreground/60">
            {dict.home.haveAccessCode}{' '}
            <Link
              href={localizedPath(lang, '/events/private')}
              className="underline underline-offset-2 hover:text-muted-foreground transition-colors"
            >
              {dict.home.accessPrivateEvent}
            </Link>
          </p>
        </div>
      </section>

      {/* Top Events */}
      {topEvents.length > 0 && (
        <section className="bg-background py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {dict.home.featuredEventsTitle}
              </h2>
              <div className="flex items-center gap-6">
                <EventStatusToggle
                  current={validStatus}
                  basePath={localizedPath(lang, '/')}
                  t={{
                    all: dict.home.statusAll,
                    upcoming: dict.home.statusUpcoming,
                    completed: dict.home.statusCompleted,
                  }}
                />
                <Link href={localizedPath(lang, '/events')}>
                  <Button variant="ghost" size="sm" className="hidden gap-1 xl:flex">
                    {dict.home.exploreAllEvents}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>

            <div className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:grid xl:grid-cols-4 xl:overflow-visible xl:pb-0">
              {topEvents.map((event) => (
                <div
                  key={event.id}
                  className="w-[80vw] shrink-0 snap-start sm:w-[45vw] xl:w-auto xl:shrink"
                >
                  <ExploreEventCard
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
                    linkPrefix={localizedPath(lang, '/events')}
                    t={{
                      photo: dict.eventCard.photo,
                      photos: dict.eventCard.photos,
                      from: dict.eventCard.from,
                      free: dict.eventCard.free,
                      noPhotosYet: dict.eventCard.noPhotosYet,
                      comingSoon: dict.events.comingSoon,
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-center xl:hidden">
              <Link href={localizedPath(lang, '/events')}>
                <Button variant="outline" size="sm">
                  {dict.home.exploreAllEvents}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* How It Works */}
      <section className="bg-background py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {dict.home.howItWorksLabel}
            </p>
            <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              {dict.home.howItWorksHeadline}
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
              {dict.home.howItWorksSubtitle}
            </p>
          </div>

          {/* Three Pillars */}
          <div className="mx-auto mt-16 max-w-6xl">
            <div className="grid gap-8 sm:grid-cols-3">
              {/* Pillar 1 */}
              <div className="group flex flex-col gap-5 rounded-2xl border bg-card p-8 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-muted/50 transition-colors group-hover:bg-primary/10">
                  <Camera className="h-5 w-5 text-foreground/70 group-hover:text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{dict.home.pillar1Title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {dict.home.pillar1Body}
                  </p>
                </div>
              </div>

              {/* Pillar 2 */}
              <div className="group flex flex-col gap-5 rounded-2xl border bg-card p-8 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-muted/50 transition-colors group-hover:bg-primary/10">
                  <Sparkles className="h-5 w-5 text-foreground/70 group-hover:text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{dict.home.pillar2Title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {dict.home.pillar2Body}
                  </p>
                </div>
              </div>

              {/* Pillar 3 */}
              <div className="group flex flex-col gap-5 rounded-2xl border bg-card p-8 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-muted/50 transition-colors group-hover:bg-primary/10">
                  <Download className="h-5 w-5 text-foreground/70 group-hover:text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{dict.home.pillar3Title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {dict.home.pillar3Body}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <PricingSection isAuthenticated={isAuthenticated} t={dict.pricingSection} />

      {/* Final CTA */}
      <section className="bg-linear-to-br from-primary/10 via-primary/5 to-background py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-semibold sm:text-4xl">{dict.home.ctaHeadline}</h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              {dict.home.ctaSubtitle}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href={localizedPath(lang, '/signup')}>
                <Button size="lg" className="group px-8 text-base">
                  {dict.home.ctaCreateAccount}
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
              <Link href={localizedPath(lang, '/login')}>
                <Button size="lg" variant="outline" className="px-8 text-base">
                  {dict.home.ctaHaveAccount}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer dict={dict} lang={lang} />
    </div>
  );
}
