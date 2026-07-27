import { Camera, Pencil } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getPhotographerEventsAction,
  getPhotographerProfileAction,
} from '@/app/[lang]/photographer/[slug]/actions';
import { CopyLinkButton } from '@/components/copy-link-button';
import { EventCard } from '@/components/event-card';
import { PhotographerProfileHeader } from '@/components/photographer-profile-header';
import { buttonVariants } from '@/components/ui/button-variants';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { stringifyJsonLd } from '@/lib/json-ld';

type PhotographerPublicProfileProps = {
  /** Photographer's public slug (used to load data and build the canonical URL). */
  slug: string;
  lang: string;
  dict: Dictionary;
  /**
   * When true, the hero renders the Edit + Copy-link CTAs. The caller is
   * responsible for deciding ownership — the public route checks auth, the
   * dashboard /preview route knows the viewer is the photographer.
   */
  isOwner: boolean;
};

/**
 * Shared profile body — rendered identically by:
 *
 *   1. `/photographer/[slug]` (public site chrome) for any visitor
 *   2. `/dashboard/photographer/profile/preview` (dashboard chrome) for the
 *      photographer to preview their own profile without leaving the
 *      dashboard sidebar/bottom-nav.
 *
 * Wrapping layout (max-w container, Footer) is the caller's job — both
 * routes use different surrounding chrome.
 */
export async function PhotographerPublicProfile({
  slug,
  lang,
  dict,
  isOwner,
}: PhotographerPublicProfileProps) {
  const profile = await getPhotographerProfileAction(slug);
  if (!profile) notFound();

  const { events: photographerEvents } = await getPhotographerEventsAction(profile.id, slug);

  const displayName = profile.display_name ?? profile.username;
  const p = dict.photographerProfile;
  const siteUrl = getSiteUrl();
  // Always the canonical PUBLIC URL — what gets shared externally, even
  // when this component is rendered inside the dashboard preview.
  const canonicalUrl = `${siteUrl}/${lang}/photographer/${slug}`;

  // JSON-LD Person schema — helps search engines understand who this page
  // represents. `address` is nested only when both city and country_code
  // are available so we never emit a half-formed PostalAddress.
  const personSchema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: displayName,
    alternateName: `@${profile.username}`,
    url: canonicalUrl,
    jobTitle: p.jobTitle,
  };
  if (profile.avatar_url) personSchema.image = profile.avatar_url;
  if (profile.bio) personSchema.description = profile.bio;
  if (profile.city && profile.country_code) {
    personSchema.address = {
      '@type': 'PostalAddress',
      addressLocality: profile.city,
      addressCountry: profile.country_code,
    };
  }

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: stringifyJsonLd escapes script-breaking characters.
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(personSchema) }}
      />

      <div>
        <PhotographerProfileHeader
          displayName={displayName}
          username={profile.username}
          avatarUrl={profile.avatar_url}
          bio={profile.bio}
          city={profile.city}
          countryCode={profile.country_code}
          createdAt={profile.created_at}
          eventCount={profile.eventCount}
          photoCount={profile.photoCount}
          labels={{
            locationFormat: p.locationFormat,
            photographerSince: p.photographerSince,
            eventsCount: p.eventsCount,
            eventsCountOne: p.eventsCountOne,
            photosCount: p.photosCount,
            photosCountOne: p.photosCountOne,
          }}
        />

        {isOwner && (
          // Owner-only action row — edit info or copy the shareable URL. Sits
          // below the identity block (after the location/member-since meta).
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href={`/${lang}/dashboard/photographer/profile/edit`}
              className={buttonVariants({ variant: 'default', size: 'sm' })}
            >
              <Pencil className="mr-2 h-4 w-4" />
              {p.editProfile}
            </Link>
            <CopyLinkButton
              value={canonicalUrl}
              copyLabel={p.copyProfileLink}
              copiedLabel={p.copied}
            />
          </div>
        )}
      </div>

      <section className={photographerEvents.length === 0 ? 'flex flex-1 flex-col' : undefined}>
        <h2 className="mb-4 text-xl font-semibold tracking-tight sm:text-2xl">{p.events}</h2>
        {photographerEvents.length === 0 ? (
          // `flex-1` grows the empty state to fill the leftover viewport height
          // (the dashboard preview wraps this in a full-height flex column), so
          // it never demands scroll on its own regardless of the bio length.
          // `min-h` is the floor for contexts without a height chain to fill
          // (the public profile route, whose <main> isn't a flex column).
          <div className="flex min-h-[18rem] flex-1 flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center">
            <Camera className="mb-4 h-12 w-12 text-muted-foreground/40" aria-hidden />
            <p className="font-medium">{p.noEvents}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{p.noEventsBody}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
            {photographerEvents.map((event, index) => (
              <EventCard
                key={event.id}
                id={event.id}
                hrefParam={(event as { slug?: string | null }).slug ?? event.id}
                name={event.name}
                date={event.date}
                city={event.city}
                country={event.country}
                activity={event.activity}
                activityLabel={
                  dict.activities[event.activity as keyof typeof dict.activities] ?? event.activity
                }
                photoCount={event.photoCount}
                coverUrl={event.coverUrl}
                linkPrefix={`/${lang}/events`}
                priority={index < 4}
                hideSaveButton={isOwner}
                t={{
                  photo: dict.eventCard.photo,
                  photos: dict.eventCard.photos,
                  noPhotosYet: dict.eventCard.noPhotosYet,
                  imageUnavailable: dict.eventCard.imageUnavailable,
                  share: dict.eventCard.share,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
