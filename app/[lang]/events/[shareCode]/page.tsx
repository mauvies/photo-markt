import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getActiveRole } from '@/app/[lang]/actions/roles';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { AIMatchingButton } from '@/app/[lang]/dashboard/talent/photos/ai-matching/ai-matching-button';
import { CartLinkButton } from '@/components/cart-link-button';
import {
  createPhotoUrls,
  getEventByShareCode,
  getEventBySlug,
  getEventPhotosPublic,
  isPhotoInCart,
  type SupabaseServerClient,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getBaseUrl } from '@/lib/get-base-url';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Locale } from '@/lib/i18n/config';
import { locales } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { PublicEventPhotoViewer } from './public-event-photo-viewer';

// ─── Types ────────────────────────────────────────────────────────────────────

type EventRow = {
  id: string;
  name: string;
  date: string;
  city: string;
  country: string;
  state: string;
  activity: string;
  is_public: boolean;
  share_code: string | null;
  slug: string | null;
  price_per_photo: number | null;
  watermark_enabled: boolean;
  user_id: string;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getCachedEventData(param: string): Promise<{
  event: EventRow;
  photos: Awaited<ReturnType<typeof getEventPhotosPublic>>;
} | null> {
  'use cache';
  cacheTag(`event-${param}`, 'events-public');
  // 55 min TTL — safely under the 60-min signed URL expiry
  cacheLife({ revalidate: 55 * 60, expire: 55 * 60 });

  let event: EventRow | null = null;

  // 1. UUID → direct public event lookup by primary key
  if (UUID_REGEX.test(param)) {
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('id', param)
      .eq('is_public', true)
      .is('deleted_at', null)
      .single();
    if (error || !data) return null;
    event = data as EventRow;
  } else {
    // 2. Try SEO slug (public events only)
    const bySlug = await getEventBySlug(supabaseAdmin as unknown as SupabaseServerClient, param);
    if (bySlug) {
      event = bySlug as EventRow;
    } else {
      // 3. Fall back to share code (handles private events)
      const byShareCode = await getEventByShareCode(
        supabaseAdmin as unknown as SupabaseServerClient,
        param,
      );
      event = byShareCode as EventRow | null;
    }
  }

  if (!event) return null;

  const photos = await getEventPhotosPublic(
    supabaseAdmin as unknown as SupabaseServerClient,
    event.id,
  );

  return { event, photos };
}

// ─── Static Params (pre-render top 50 public events) ─────────────────────────

export async function generateStaticParams() {
  const { data } = await supabaseAdmin
    .from('events')
    .select('id')
    .eq('is_public', true)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(50);

  return locales.flatMap((lang) =>
    (data ?? []).map((e: { id: string }) => ({ lang, shareCode: e.id })),
  );
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareCode: string; lang: string }>;
}): Promise<Metadata> {
  const { shareCode: param, lang } = await params;
  const cached = await getCachedEventData(param);

  if (!cached) return { title: 'Event Not Found' };
  const { event } = cached;

  const siteUrl = getSiteUrl();
  const canonicalPath = event.slug ?? event.id;
  const canonicalUrl = `${siteUrl}/${lang}/events/${canonicalPath}`;

  const activityLabel =
    activityOptions.find((o) => o.value === event.activity)?.label ?? event.activity;
  const location = [event.city, event.country].filter(Boolean).join(', ');
  const formattedDate = new Date(event.date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const title = `${event.name} Photos | ${location} | ${formattedDate}`;
  const description = `Browse ${activityLabel} photos from ${event.name} in ${location} on ${formattedDate}. Find yourself in professional high-resolution event photos and download your best shots.`;

  const ogImages: { url: string; width: number; height: number; alt: string }[] = [];
  const { data: firstPhotoRow } = await supabaseAdmin
    .from('photos')
    .select('original_url')
    .eq('event_id', event.id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (firstPhotoRow?.original_url) {
    const { data: signedData } = await supabaseAdmin.storage
      .from('photos')
      .createSignedUrl(firstPhotoRow.original_url, 60 * 60 * 24);
    if (signedData?.signedUrl) {
      ogImages.push({ url: signedData.signedUrl, width: 1200, height: 630, alt: title });
    }
  }

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
      languages: {
        es: `${siteUrl}/es/events/${canonicalPath}`,
        en: `${siteUrl}/en/events/${canonicalPath}`,
        'x-default': `${siteUrl}/es/events/${canonicalPath}`,
      },
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: 'article',
      images: ogImages,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImages.map((i) => i.url),
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EventPage({
  params,
}: {
  params: Promise<{ shareCode: string; lang: string }>;
}) {
  const { shareCode: param, lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();

  const cached = await getCachedEventData(param);
  if (!cached) notFound();
  const { event, photos } = cached;

  // Permanent redirect: UUID visitors with a slug get sent to the canonical slug URL.
  if (UUID_REGEX.test(param) && event.slug) {
    localizedRedirect(lang, `/events/${event.slug}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const useWatermark = event.watermark_enabled === true;
  const photosInCart: string[] = [];

  try {
    if (user) {
      const { activeRole } = await getActiveRole();
      if (activeRole === 'talent') {
        for (const photo of photos) {
          const inCart = await isPhotoInCart(
            supabase as unknown as SupabaseServerClient,
            user.id,
            photo.id,
          );
          if (inCart) photosInCart.push(photo.id);
        }
      }
    }
  } catch {
    // ignore — photosInCart stays empty
  }

  const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);
  const signed: Record<string, string> = {};

  if (paths.length > 0) {
    const baseUrl = await getBaseUrl();
    const photoUrls = await createPhotoUrls(
      supabaseAdmin as unknown as SupabaseServerClient,
      'photos',
      paths,
      { expiresIn: 60 * 60, useWatermark, baseUrl },
    );
    for (const item of photoUrls) {
      if (item.signedUrl) signed[item.path] = item.signedUrl;
    }
  }

  const activityLabel =
    activityOptions.find((o) => o.value === event.activity)?.label ?? event.activity;
  const location = [event.city, event.country].filter(Boolean).join(', ');

  const photoItems = photos
    .map((p) => {
      const url = p.original_url ? signed[p.original_url] : null;
      if (!url) return null;
      return {
        id: p.id,
        url,
        alt: `${activityLabel} photo at ${event.name} in ${location}`,
        originalPath: p.original_url,
      };
    })
    .filter(
      (item): item is { id: string; url: string; alt: string; originalPath: string | null } =>
        item !== null,
    );

  // ─── Structured data (JSON-LD) ──────────────────────────────────────────────
  const siteUrl = getSiteUrl();
  const canonicalPath = event.slug ?? event.id;
  const eventUrl = `${siteUrl}/${lang}/events/${canonicalPath}`;
  const coverUrl = photoItems[0]?.url ?? null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SportsEvent',
        name: event.name,
        startDate: event.date,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        url: eventUrl,
        ...(coverUrl ? { image: coverUrl } : {}),
        location: {
          '@type': 'Place',
          name: event.city,
          address: {
            '@type': 'PostalAddress',
            addressLocality: event.city,
            addressRegion: event.state,
            addressCountry: event.country,
          },
        },
        organizer: {
          '@type': 'Organization',
          name: 'Photo Markt',
          url: siteUrl,
        },
        ...(event.price_per_photo !== null
          ? {
              offers: {
                '@type': 'Offer',
                price: event.price_per_photo,
                priceCurrency: 'USD',
                availability: 'https://schema.org/InStock',
                url: eventUrl,
              },
            }
          : {}),
      },
      {
        '@type': 'ImageGallery',
        name: `${event.name} — Photo Gallery`,
        description: `${activityLabel} photos from ${event.name} in ${location}`,
        url: eventUrl,
        numberOfItems: photoItems.length,
        ...(coverUrl ? { thumbnailUrl: coverUrl } : {}),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
          { '@type': 'ListItem', position: 2, name: 'Events', item: `${siteUrl}/${lang}/events` },
          { '@type': 'ListItem', position: 3, name: event.name, item: eventUrl },
        ],
      },
    ],
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Structured data — server-generated, not user input */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: server-generated structured data
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-7xl w-full flex-1 px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{event.name}</h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {new Date(event.date).toDateString().split(' ').slice(1).join(' ')} •{' '}
              {event.city[0]?.toUpperCase() + event.city.slice(1)}
              {event.price_per_photo !== null && (
                <>
                  {' '}
                  • ${event.price_per_photo.toFixed(2)} {dict.events.perPhoto}
                </>
              )}
            </div>
          </div>
          <CartLinkButton guest={!user} />
        </div>

        {photoItems.length > 0 && (
          <div className="mb-3 flex justify-end">
            <AIMatchingButton className="h-9 rounded-full" />
          </div>
        )}
        <Suspense
          fallback={
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
                <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          }
        >
          <PublicEventPhotoViewer
            photos={photoItems}
            eventId={event.id}
            eventName={event.name}
            eventDate={event.date}
            pricePerPhoto={event.price_per_photo}
            photographerId={event.user_id}
            isAuthenticated={!!user}
            initialPhotosInCart={photosInCart}
            iconTooltips={dict.photoIconButtons}
          />
        </Suspense>
      </div>
    </div>
  );
}
