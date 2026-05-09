import { Camera } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { EventCard } from '@/components/event-card';
import { Footer } from '@/components/footer';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Locale } from '@/lib/i18n/config';
import { locales } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import {
  getPhotographerEventsAction,
  getPhotographerProfileAction,
  getTopPhotographersAction,
} from './actions';

type Params = Promise<{ lang: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const profile = await getPhotographerProfileAction(slug);

  if (!profile) return {};

  const name = profile.display_name ?? profile.username;
  const siteUrl = getSiteUrl();

  return {
    title: `${name} — Event Photographer`,
    description: `Browse all events and photos by ${name} on Photo Markt.`,
    openGraph: {
      title: `${name} — Event Photographer | Photo Markt`,
      description: `Browse all events and photos by ${name} on Photo Markt.`,
      images: profile.avatar_url
        ? [{ url: profile.avatar_url, width: 400, height: 400, alt: name }]
        : [],
      url: `${siteUrl}/photographer/${slug}`,
      type: 'profile',
    },
    alternates: {
      canonical: `${siteUrl}/photographer/${slug}`,
    },
  };
}

export async function generateStaticParams() {
  const top = await getTopPhotographersAction();
  return locales.flatMap((lang) => top.map((p) => ({ lang, slug: p.slug })));
}

export default async function PhotographerProfilePage({ params }: { params: Params }) {
  const { lang, slug } = await params;
  const dict = await getDictionary(lang as Locale);

  const profile = await getPhotographerProfileAction(slug);
  if (!profile) notFound();

  const { events: photographerEvents } = await getPhotographerEventsAction(profile.id, slug);

  const displayName = profile.display_name ?? profile.username;
  const p = dict.photographerProfile;

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
        {/* Profile header */}
        <section className="mb-6 flex flex-col">
          {/* Avatar */}
          <div className="relative mb-4 h-24 w-24 overflow-hidden rounded-full bg-muted ring-2 ring-border">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <Image
                src={profile.avatar_url}
                alt={displayName}
                fill
                sizes="96px"
                className="object-cover"
                loading="eager"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Camera className="h-10 w-10 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Name + username */}
          <h1 className="text-3xl font-bold leading-tight">{displayName}</h1>
          <p className="mt-1 text-muted-foreground">@{profile.username}</p>

          {/* Bio */}
          {profile.bio && (
            <p className="mt-3 max-w-prose text-sm text-muted-foreground">{profile.bio}</p>
          )}
        </section>

        {/* Events grid */}
        <section>
          <h2 className="mb-6 text-xl font-semibold">{p.events}</h2>
          {photographerEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Camera className="mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground">{p.noEvents}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {photographerEvents.map((event) => (
                <EventCard
                  key={event.id}
                  id={event.id}
                  hrefParam={(event as { slug?: string | null }).slug ?? event.id}
                  name={event.name}
                  date={event.date}
                  city={event.city}
                  country={event.country}
                  activity={event.activity}
                  photoCount={event.photoCount}
                  coverUrl={event.coverUrl}
                  linkPrefix={`/${lang}/events`}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer dict={dict} lang={lang} />
    </div>
  );
}
