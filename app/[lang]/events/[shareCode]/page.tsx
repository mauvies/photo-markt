import { CalendarClock } from 'lucide-react';
import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getActiveRole } from '@/app/[lang]/actions/roles';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { AIMatchingButton } from '@/app/[lang]/dashboard/talent/photos/ai-matching/ai-matching-button';
import {
  createPhotoUrls,
  getEventByShareCode,
  getEventBySlug,
  getEventPhotosPublic,
  getPhotoIdsInCart,
  type SupabaseServerClient,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getEventStatus, isCollaborativeUploadOpen } from '@/lib/event-status';
import { getBaseUrl } from '@/lib/get-base-url';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Locale } from '@/lib/i18n/config';
import { locales } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { stringifyJsonLd } from '@/lib/json-ld';
import { ContributeModal } from './contribute-modal';
import { ContributeTriggerCard } from './contribute-trigger-card';
import { PublicEventPhotoViewer } from './public-event-photo-viewer';
import { UploadProgressProvider } from './upload-progress-provider';

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
  is_collaborative: boolean;
  allow_guest_upload: boolean;
  require_upload_approval: boolean;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getCachedEventData(
  param: string,
  // baseUrl is computed via headers() outside the cache (dynamic data sources
  // like headers() can't run inside `'use cache'`) and passed in so the
  // cached output stays deterministic for a given (param, baseUrl) pair.
  baseUrl: string,
): Promise<{
  event: EventRow;
  photos: Awaited<ReturnType<typeof getEventPhotosPublic>>;
  /**
   * Pre-signed photo URLs keyed by storage path, generated inside the cache
   * so they survive trivial re-renders (e.g. opening/closing the contribute
   * modal via `?contribute=1`). Without caching, every render produced new
   * signed strings, the `<Image>` src changed, and the browser re-fetched —
   * producing a visible flash.
   */
  signed: Record<string, string>;
  /** Profile lookup for `uploaded_by` ids, for the contributor badge. */
  uploaderProfiles: Record<string, { display_name: string | null; username: string }>;
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

  // Sign storage paths once per cache window. Skip for upcoming events (the
  // gallery isn't shown anyway).
  const signed: Record<string, string> = {};
  const eventStatusInside = getEventStatus(event.date);
  if (eventStatusInside !== 'upcoming') {
    const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);
    if (paths.length > 0) {
      const photoUrls = await createPhotoUrls(
        supabaseAdmin as unknown as SupabaseServerClient,
        'photos',
        paths,
        {
          expiresIn: 60 * 60,
          useWatermark: event.watermark_enabled === true,
          baseUrl,
        },
      );
      for (const item of photoUrls) {
        if (item.signedUrl) signed[item.path] = item.signedUrl;
      }
    }
  }

  // Resolve display names for authenticated contributors so the public
  // uploader badge can render their name without an extra round-trip.
  const uploaderUserIds = Array.from(
    new Set(
      photos
        .map((p) => (p as { uploaded_by?: string | null }).uploaded_by)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const uploaderProfiles: Record<string, { display_name: string | null; username: string }> = {};
  if (uploaderUserIds.length > 0) {
    const { data: profilesData } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, username')
      .in('id', uploaderUserIds);
    for (const row of profilesData ?? []) {
      uploaderProfiles[row.id as string] = {
        display_name: (row.display_name as string | null) ?? null,
        username: row.username as string,
      };
    }
  }

  return { event, photos, signed, uploaderProfiles };
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
  const baseUrl = await getBaseUrl();
  const cached = await getCachedEventData(param, baseUrl);

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
  const baseUrl = await getBaseUrl();

  const cached = await getCachedEventData(param, baseUrl);
  if (!cached) notFound();
  const { event, photos, signed, uploaderProfiles } = cached;

  // Permanent redirect: UUID visitors with a slug get sent to the canonical slug URL.
  if (UUID_REGEX.test(param) && event.slug) {
    localizedRedirect(lang, `/events/${event.slug}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const eventStatus = getEventStatus(event.date);
  // Free collaborative events skip the cart entirely — no purchase flow.
  const isForSale = event.price_per_photo !== null;
  const showCartUi = isForSale;
  const uploadOpen = isCollaborativeUploadOpen(event.date);
  const isCollaborativeShareable =
    event.is_collaborative && event.allow_guest_upload && Boolean(event.share_code);
  const showContribute = isCollaborativeShareable && uploadOpen;
  const showContributeLockedNotice = isCollaborativeShareable && !uploadOpen;
  const photosInCart: string[] = [];

  try {
    if (showCartUi && user && eventStatus !== 'upcoming') {
      const { activeRole } = await getActiveRole();
      if (activeRole === 'talent') {
        const photoIds = photos.map((p) => p.id);
        const cartIds = await getPhotoIdsInCart(
          supabase as unknown as SupabaseServerClient,
          user.id,
          photoIds,
        );
        for (const id of cartIds) photosInCart.push(id);
      }
    }
  } catch {
    // ignore — photosInCart stays empty
  }

  const activityLabel =
    activityOptions.find((o) => o.value === event.activity)?.label ?? event.activity;
  const location = [event.city, event.country].filter(Boolean).join(', ');

  const photoItems = photos
    .map((p) => {
      const url = p.original_url ? signed[p.original_url] : null;
      if (!url) return null;
      const uploadedBy = (p as { uploaded_by?: string | null }).uploaded_by ?? null;
      const guestName = (p as { guest_name?: string | null }).guest_name ?? null;
      let uploader: { name: string; isAuthenticated: boolean } | undefined;
      if (uploadedBy) {
        const profile = uploaderProfiles[uploadedBy];
        const name = profile?.display_name ?? profile?.username ?? guestName ?? '';
        if (name) uploader = { name, isAuthenticated: true };
      } else if (guestName) {
        uploader = { name: guestName, isAuthenticated: false };
      }
      return {
        id: p.id,
        url,
        alt: `${activityLabel} photo at ${event.name} in ${location}`,
        originalPath: p.original_url,
        uploadedBy,
        uploader,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

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
      {/* Structured data — escaped for safe inline-script embedding */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: payload escaped via stringifyJsonLd
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(jsonLd) }}
      />
      <UploadProgressProvider
        labels={{
          successApproved: dict.collaborativeEvent.successApproved,
          successPending: dict.collaborativeEvent.successPending,
          errorGeneric: dict.collaborativeEvent.errorGeneric,
        }}
      >
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
          </div>

          {showContribute && event.share_code ? (
            <div className="mb-6">
              <ContributeTriggerCard
                title={dict.collaborativeEvent.contributeCardTitle}
                description={dict.collaborativeEvent.contributeCardDesc}
                buttonLabel={dict.collaborativeEvent.contributeCardButton}
              />
              {/* The Dropzone inside the modal reads its labels ("Upload",
                "Or drag files here") from the newEvent namespace via
                useTranslations. */}
              <TranslationsProvider translations={dict.newEvent}>
                <ContributeModal
                  shareCode={event.share_code}
                  isAuthenticated={Boolean(user)}
                  requireApproval={event.require_upload_approval}
                  t={dict.collaborativeEvent}
                />
              </TranslationsProvider>
            </div>
          ) : null}

          {showContributeLockedNotice ? (
            <div className="mb-6 rounded-lg border border-dashed border-input bg-muted/30 p-4 text-sm text-muted-foreground">
              {dict.collaborativeEvent.contributeOpensOn.replace(
                '{date}',
                new Date(event.date).toDateString().split(' ').slice(1).join(' '),
              )}
            </div>
          ) : null}

          {eventStatus === 'upcoming' ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
              <CalendarClock className="h-12 w-12 text-muted-foreground opacity-40" />
              <p className="text-lg font-semibold">{dict.events.comingSoon}</p>
              <p className="text-sm text-muted-foreground">{dict.events.photosAfterEvent}</p>
            </div>
          ) : (
            <>
              {showCartUi && photoItems.length > 0 && (
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
                  currentUserId={user?.id ?? null}
                  shareCode={event.share_code ?? null}
                  initialPhotosInCart={photosInCart}
                  iconTooltips={dict.photoIconButtons}
                  showAddToCart={showCartUi}
                  emptyText={dict.events.galleryEmpty}
                  uploadingLabel={dict.collaborativeEvent.galleryUploadingLabel}
                  uploaderLabels={{
                    tooltip: dict.collaborativeEvent.uploaderTooltip,
                    popoverHeading: dict.collaborativeEvent.uploaderPopoverHeading,
                    guestLabel: dict.collaborativeEvent.uploaderGuestLabel,
                    authenticatedLabel: dict.collaborativeEvent.uploaderAuthenticatedLabel,
                  }}
                  deleteLabels={{
                    tooltip: dict.events.deletePhoto,
                    confirmTitle: dict.events.deletePhotoConfirmTitle,
                    confirmDesc: dict.events.deletePhotoConfirmDesc,
                    confirmButton: dict.events.confirmButton,
                    cancelButton: dict.events.cancelButton,
                    successToast: dict.events.deletePhotoToast,
                    failedToast: dict.events.deletePhotoFailed,
                  }}
                  cartToastLabels={{
                    failedAdd: dict.eventPhotoViewer.failedAddCart,
                    failedRemove: dict.eventPhotoViewer.failedRemoveCart,
                  }}
                  imageUnavailableLabel={dict.eventCard.imageUnavailable}
                />
              </Suspense>
            </>
          )}
        </div>
      </UploadProgressProvider>
    </div>
  );
}
