import { CalendarClock } from 'lucide-react';
import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getActiveRole } from '@/app/[lang]/actions/roles';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { EventGalleryWithFaceSearch } from '@/components/event-gallery-with-face-search';
import { EventMetaLine } from '@/components/event-meta-line';
import { EventPricingSection } from '@/components/event-pricing-section';
import { EventShareButton } from '@/components/event-share-button';
import { GatedFaceSearchNotice } from '@/components/gated-face-search-notice';
import {
  countEventPhotosByStatus,
  createPhotoUrlMap,
  getEventByShareCode,
  getEventBySlug,
  getEventPhotosPublicByIds,
  getEventPhotosPublicPage,
  getProfilesByIds,
  type PhotoDetail,
  resolveEventOgImageUrl,
  type SupabaseServerClient,
} from '@/database/queries';
import { getPurchasedPhotoIdsForEvent } from '@/database/queries/orders';
import {
  getEventAiIndexingProgress,
  getEventRekognitionState,
} from '@/database/queries/rekognition';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { parseBundleTiers } from '@/lib/bundle-pricing';
import { PLATFORM_CURRENCY_CODE } from '@/lib/currency';
import { eventDetailCacheTags } from '@/lib/event-cache-tags';
import { EVENT_GALLERY_PAGE_SIZE } from '@/lib/event-gallery';
import { overrideEventTotalPhotoCount } from '@/lib/event-photo-count-overrides';
import { getEventStatus, isCollaborativeUploadOpen } from '@/lib/event-status';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { resolveGatedFaceSearchNotice } from '@/lib/find-my-photos';
import { formatEventLocation } from '@/lib/format-location';
import { getBaseUrl } from '@/lib/get-base-url';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Locale } from '@/lib/i18n/config';
import { locales } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { stringifyJsonLd } from '@/lib/json-ld';
import { needsProtectedPreview } from '@/lib/preview-protection';
import { getProvenRevealIds } from '@/lib/reveal-gate';
import { isEventRevealGated } from '@/lib/reveal-token';
import { ContributeDialog } from './contribute-dialog';
import { buildPublicPhotoAlbumItem, type UploaderProfileMap } from './photo-album-item';
import { PublicEventPhotoViewer } from './public-event-photo-viewer';
import { UploadProgressProvider } from './upload-progress-provider';

// ─── Types ────────────────────────────────────────────────────────────────────

type EventRow = {
  id: string;
  name: string;
  date: string;
  session_time: string | null;
  session_end_time: string | null;
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
  // Optional: the slug/share-code lookups return a row type that predates this
  // column; `select('*')` carries it at runtime. Read via `isEventRevealGated`.
  reveal_gate_enabled?: boolean;
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
  /** The first gallery page only — subsequent pages load via a Server Action. */
  photos: PhotoDetail[];
  /** Whether more approved photos exist beyond the first page. */
  hasMore: boolean;
  /** True total of approved photos — drives JSON-LD `numberOfItems` even though
   * only the first page renders. */
  totalCount: number;
  /**
   * Pre-signed photo URLs keyed by storage path, generated inside the cache
   * so they survive trivial re-renders. Without caching, every render produced
   * new signed strings, the `<Image>` src changed, and the browser re-fetched —
   * producing a visible flash.
   */
  signed: Record<string, string>;
  /** Profile lookup for `uploaded_by` ids, for the contributor badge. */
  uploaderProfiles: UploaderProfileMap;
  /** Signed URL for the dedicated cover image (T-055), if the event has one. */
  coverSignedUrl: string | null;
} | null> {
  'use cache';
  cacheTag(...eventDetailCacheTags(param));
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

  const adminForPhotos = supabaseAdmin as unknown as SupabaseServerClient;
  const eventStatusInside = getEventStatus(event.date);
  // Dedicated cover image (T-055), if any — signed un-watermarked (it's a chosen
  // presentation image, not a for-sale photo) so the JSON-LD can prefer it.
  const coverPath = (event as { cover_path?: string | null }).cover_path ?? null;

  // Reveal gate (T-177): a gated event has no browsable gallery — its photos
  // are revealed only through face search. Skip the page fetch entirely so no
  // photo record is ever cached/shipped to an unproven visitor. The revealed
  // set is fetched per-request (uncached, keyed on the proof cookie) in the
  // page body — a proven and an unproven request must never share a cached
  // photo list. `totalCount` and the dedicated cover stay (public by design).
  const gated = isEventRevealGated(event);

  // Round 1 — the first gallery page (only the first page is fetched + signed;
  // a 264-photo event used to sign all 264), the true approved count, and the
  // cover signature are mutually independent (each needs only the event).
  const [{ photos, hasMore }, approvedCount, coverSignedUrl] = await Promise.all([
    gated
      ? Promise.resolve({ photos: [] as PhotoDetail[], hasMore: false })
      : getEventPhotosPublicPage(adminForPhotos, event.id, {
          limit: EVENT_GALLERY_PAGE_SIZE,
          offset: 0,
        }),
    countEventPhotosByStatus(adminForPhotos, event.id, ['approved']),
    coverPath
      ? supabaseAdmin.storage
          .from('photos')
          .createSignedUrl(coverPath, 60 * 60)
          .then((r) => r.data?.signedUrl ?? null)
      : Promise.resolve<string | null>(null),
  ]);

  // Round 2 — signing the page and resolving uploader names both depend only on
  // `photos`, so run them together. Signing is skipped for upcoming events (the
  // gallery isn't shown). The owner profile is only read for collaborative
  // attribution, so don't fetch it on non-collaborative events.
  const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);
  const uploaderUserIds = Array.from(
    new Set([
      // The owner profile is always resolved now: collaborative attribution
      // needs it, and the two-panel purchase modal shows the photographer's
      // name for non-collaborative events too.
      event.user_id,
      ...photos
        .map((p) => (p as { uploaded_by?: string | null }).uploaded_by)
        .filter((v): v is string => Boolean(v)),
    ]),
  );
  const [signed, uploaderProfiles] = await Promise.all([
    eventStatusInside !== 'upcoming'
      ? createPhotoUrlMap(adminForPhotos, 'photos', paths, {
          expiresIn: 60 * 60,
          // Watermarked OR sellable events route through the fail-closed
          // /api/watermark/ route — never a direct signed full-res original
          // pre-purchase (T-136; shared predicate with the cart resolver).
          useWatermark: needsProtectedPreview(event),
          baseUrl,
        })
      : Promise.resolve<Record<string, string>>({}),
    getProfilesByIds(adminForPhotos, uploaderUserIds),
  ]);

  // TEMP test override (see event-photo-count-overrides.ts): force a fixed
  // large total for a few prod events that have no real photos yet. Non-listed
  // events fall through to the real approved count.
  const totalCount = overrideEventTotalPhotoCount(event.id, approvedCount);

  return { event, photos, hasMore, totalCount, signed, uploaderProfiles, coverSignedUrl };
}

/**
 * Reveal gate (T-177): fetch + sign the photos a visitor has proven a match for.
 * Intentionally NOT cached — it depends on the per-request proof cookie, so a
 * proven and an unproven request never share a cached photo list. Reuses the
 * same protected-preview signing as the cached loader.
 */
async function getRevealedEventPhotos(
  event: EventRow,
  provenIds: string[],
  baseUrl: string,
): Promise<{ photos: PhotoDetail[]; signed: Record<string, string> }> {
  const admin = supabaseAdmin as unknown as SupabaseServerClient;
  const photos = await getEventPhotosPublicByIds(admin, event.id, provenIds);
  const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);
  const signed = await createPhotoUrlMap(admin, 'photos', paths, {
    expiresIn: 60 * 60,
    useWatermark: needsProtectedPreview(event),
    baseUrl,
  });
  return { photos, signed };
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
  const location = formatEventLocation(event);
  const formattedDate = new Date(event.date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const title = `${event.name} Photos | ${location} | ${formattedDate}`;
  const description = `Browse ${activityLabel} photos from ${event.name} in ${location} on ${formattedDate}. Find yourself in professional high-resolution event photos and download your best shots.`;

  const ogImages: { url: string; width: number; height: number; alt: string }[] = [];
  // Prefer the dedicated cover image (T-055) — the presentation image the
  // photographer chose, and social/SEO previews are exactly where it matters
  // most. A first-photo fallback for a watermarked/for-sale event is served
  // through the fail-closed /api/watermark/ derivative, never a direct signed
  // full-res original in <meta og:image> (T-140, shared predicate with the
  // in-page gallery signing above).
  const ogImageUrl = await resolveEventOgImageUrl(supabaseAdmin, {
    eventId: event.id,
    coverPath: (event as { cover_path?: string | null }).cover_path ?? null,
    watermarkEnabled: event.watermark_enabled,
    pricePerPhoto: event.price_per_photo,
    baseUrl,
    revealGated: isEventRevealGated(event),
  });
  if (ogImageUrl) {
    ogImages.push({ url: ogImageUrl, width: 1200, height: 630, alt: title });
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
  const { event, hasMore, totalCount, uploaderProfiles, coverSignedUrl } = cached;
  // Reveal gate (T-177): the cached loader ships no photos for a gated event.
  // If this request carries a valid proof cookie, fetch the revealed set
  // per-request below and substitute it in; otherwise these stay empty.
  let photos = cached.photos;
  let signed = cached.signed;

  // Permanent redirect: UUID visitors with a slug get sent to the canonical slug URL.
  if (UUID_REGEX.test(param) && event.slug) {
    localizedRedirect(lang, `/events/${event.slug}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Authenticated talents belong on their dashboard's event view — send them
  // there server-side (before any markup) so they get the talent experience.
  // Photographers and guests stay on this public page.
  let activeRole: 'photographer' | 'talent' | null = null;
  if (user) {
    try {
      activeRole = (await getActiveRole()).activeRole;
    } catch {
      // getActiveRole throws if the session is somehow gone — treat as no role.
    }
    if (activeRole === 'talent') {
      localizedRedirect(lang, `/dashboard/talent/events/${param}`);
    }
  }

  const eventStatus = getEventStatus(event.date);

  // Reveal gate (T-177): substitute the proven photo set for a gated event when
  // this request carries a valid proof cookie. Unproven → photos stays empty →
  // the gated empty state + search entry render.
  const gated = isEventRevealGated(event);
  if (gated && eventStatus !== 'upcoming') {
    const provenIds = await getProvenRevealIds(event.id);
    if (provenIds.size > 0) {
      const revealed = await getRevealedEventPhotos(event, Array.from(provenIds), baseUrl);
      photos = revealed.photos;
      signed = revealed.signed;
    }
  }

  // AI face search eligibility — computed server-side. We hide the banner
  // entirely for events that can't surface useful results: AI disabled,
  // contains_minors, failed indexing, or nothing indexed yet (counter at 0).
  // The wrapper component handles the matches-view state purely client-side.
  let aiSearchEligible = false;
  let aiBannerState: 'ready' | 'indexing' = 'ready';
  // `aiUsable` / `aiStatus` feed the reveal-gate dead-end guard (T-184).
  let aiUsable = false;
  let aiStatus: 'idle' | 'indexing' | 'ready' | 'failed' | null = null;
  if (isFeatureEnabled('AI_MATCHING')) {
    try {
      const adminClientForAi = supabaseAdmin as unknown as SupabaseServerClient;
      const aiState = await getEventRekognitionState(adminClientForAi, event.id);
      aiStatus = aiState?.status ?? null;
      if (
        aiState?.enabled &&
        !aiState.containsMinors &&
        aiState.collectionId &&
        aiState.status !== 'failed'
      ) {
        aiUsable = true;
        const aiProgress = await getEventAiIndexingProgress(adminClientForAi, event.id);
        if (aiProgress.indexed > 0) {
          aiSearchEligible = true;
          aiBannerState = aiState.status === 'indexing' ? 'indexing' : 'ready';
        }
      }
    } catch {
      // Best-effort — if AI state lookup fails the banner just won't render.
    }
  }

  // Reveal gate (T-177) dead-end guard (T-184): a gated event with no searchable
  // face index yet must show a clear state, not a mute empty gallery.
  const gatedFaceSearchNotice = resolveGatedFaceSearchNotice({
    gated,
    aiSearchEligible,
    aiUsable,
    aiStatus,
  });
  // Free collaborative events skip the cart entirely — no purchase flow.
  const isForSale = event.price_per_photo !== null;
  const showCartUi = isForSale;
  const uploadOpen = isCollaborativeUploadOpen(event.date);
  const isCollaborativeShareable =
    event.is_collaborative && event.allow_guest_upload && Boolean(event.share_code);
  const showContribute = isCollaborativeShareable && uploadOpen;
  const showContributeLockedNotice = isCollaborativeShareable && !uploadOpen;
  // Authenticated talents are redirected to their dashboard above, so the
  // public page's audience is photographers + guests — the talent cart never
  // applies here. Guests use the localStorage guest cart inside the viewer.
  const photosInCart: string[] = [];

  // Purchased photos — only needed to gate bulk download on a paid event for a
  // signed-in viewer. Free events download for anyone; guests get an empty set.
  let purchasedPhotoIds = new Set<string>();
  if (user && event.price_per_photo !== null && eventStatus !== 'upcoming') {
    try {
      purchasedPhotoIds = await getPurchasedPhotoIdsForEvent(
        supabase as unknown as SupabaseServerClient,
        user.id,
        event.id,
      );
    } catch {
      // best-effort — leave the set empty
    }
  }

  // Favorites the signed-in viewer already has among the loaded photos — seeds
  // the optimistic state so the purchase modal's heart renders filled (T-102).
  const photosInMyPhotos: string[] = [];
  if (user && eventStatus !== 'upcoming') {
    const photoIds = photos.map((p) => p.id);
    if (photoIds.length > 0) {
      const { data: favTags } = await supabase
        .from('talent_photo_tags')
        .select('photo_id')
        .eq('talent_user_id', user.id)
        .in('photo_id', photoIds);
      for (const tag of favTags ?? []) photosInMyPhotos.push(tag.photo_id);
    }
  }

  const bulkDownloadLabels = {
    select: dict.events.selectButton,
    exitSelection: dict.events.exitSelection,
    countNone: dict.events.noPhotosSelected,
    countOne: dict.events.onePhotoSelected,
    countMany: dict.events.nPhotosSelected,
    download: dict.events.download,
    preparing: dict.events.preparingDownload,
    failed: dict.events.downloadFailed,
    skipped: dict.events.downloadSkipped,
    nonePurchased: dict.events.downloadNonePurchased,
    addToCart: dict.events.addToCartMenuItem,
    addedToCartOne: dict.events.bulkAddedToCartOne,
    addedToCartMany: dict.events.bulkAddedToCartMany,
    alreadyInCart: dict.events.bulkAlreadyInCart,
    viewCart: dict.events.viewCart,
  };

  const activityLabel =
    activityOptions.find((o) => o.value === event.activity)?.label ?? event.activity;
  const location = formatEventLocation(event);

  const galleryAlt = `${activityLabel} photo at ${event.name} in ${location}`;
  const photoItems = photos
    .map((p) =>
      buildPublicPhotoAlbumItem(p, {
        signed,
        event,
        uploaderProfiles,
        alt: galleryAlt,
      }),
    )
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // ─── Structured data (JSON-LD) ──────────────────────────────────────────────
  const siteUrl = getSiteUrl();
  const canonicalPath = event.slug ?? event.id;
  const eventUrl = `${siteUrl}/${lang}/events/${canonicalPath}`;
  // Prefer the dedicated cover image (T-055) for structured data; fall back to
  // the first photo — but NEVER for a gated event (T-177): its photos must not
  // appear in crawlable structured data, only the dedicated promotional cover.
  const coverUrl = coverSignedUrl ?? (gated ? null : (photoItems[0]?.url ?? null));

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
                priceCurrency: PLATFORM_CURRENCY_CODE,
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
        numberOfItems: totalCount,
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
          storageLimitPartial: dict.collaborativeEvent.storageLimitPartial,
          storageLimitAll: dict.collaborativeEvent.storageLimitAll,
          progressTitle: dict.newEvent.uploadProgressTitle,
          progressPreparing: dict.newEvent.uploadStatePreparing,
          progressUploading: dict.newEvent.uploadStateUploading,
          progressFinalizing: dict.newEvent.uploadStateFinalizing,
          progressDone: dict.newEvent.uploadStateDone,
          progressPartialFailed: dict.newEvent.uploadStatePartialFailed,
          progressError: dict.newEvent.uploadStateError,
          cancelButton: dict.newEvent.uploadCancelButton,
          closeButton: dict.newEvent.uploadCloseButton,
          retryFailedButton: dict.newEvent.uploadRetryFailedButton,
        }}
      >
        <div className="mx-auto max-w-[1300px] w-full flex-1 px-3 py-4 sm:py-6 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">{event.name}</h1>
              <EventMetaLine
                className="mt-2"
                date={event.date}
                sessionTime={event.session_time}
                sessionEndTime={event.session_end_time}
                city={event.city}
                state={event.state}
                country={event.country}
                locale={lang}
                perPhotoLabel={dict.events.perPhoto}
                pricePerPhoto={event.price_per_photo}
                photographerName={uploaderProfiles[event.user_id]?.username}
              />
              {/* Reveal gate (T-177): the total lives here (not above the
                  gallery) so a gated event advertises it's worth searching,
                  while the toolbar counter reflects only what's revealed. */}
              {gated && eventStatus !== 'upcoming' ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {dict.events.photosInEvent.replace('{n}', String(totalCount))}
                </p>
              ) : null}
            </div>
            <EventShareButton
              eventName={event.name}
              eventUrl={eventUrl}
              tooltip={dict.eventShare.tooltip}
            />
          </div>

          {/* Volume pricing (T-203, D17). Mounted directly under the header and
              above everything else, the SAME slot the talent-dashboard view uses,
              so one event can never quote two different prices. Renders nothing
              for a free event or one without a ladder. */}
          <EventPricingSection
            className="mb-6"
            pricePerPhoto={event.price_per_photo}
            bundleTiers={parseBundleTiers(
              (event as unknown as Record<string, unknown>).bundle_tiers,
            )}
            labels={{
              heading: dict.bundlePricing.heading,
              singlePhoto: dict.bundlePricing.singlePhoto,
              photosOrMore: dict.bundlePricing.photosOrMore,
              eachSuffix: dict.bundlePricing.eachSuffix,
              ladderHint: dict.bundlePricing.ladderHint,
            }}
          />

          {showContribute && event.share_code ? (
            <div className="mb-4">
              {/* The Dropzone inside the modal reads its labels ("Upload",
                "Or drag files here") from the newEvent namespace via
                useTranslations. */}
              <TranslationsProvider translations={dict.newEvent}>
                <ContributeDialog
                  eventId={event.id}
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
          ) : gatedFaceSearchNotice !== 'none' ? (
            // Reveal gate (T-177) dead-end guard (T-184): gated event with no
            // searchable face index yet — show a clear state, not a mute empty
            // gallery the visitor can't escape.
            <GatedFaceSearchNotice
              state={gatedFaceSearchNotice}
              labels={dict.aiSearch.gatedNotice}
            />
          ) : (
            <EventGalleryWithFaceSearch
              shareCode={event.share_code ?? event.id}
              aiSearchEligible={aiSearchEligible}
              aiState={aiBannerState}
              modalLabels={dict.aiSearch.modal}
              bibDetectionEnabled={
                // Reveal gate (T-177): v1 unlocks by face only — never bib.
                !gated &&
                Boolean((event as unknown as Record<string, unknown>).bib_detection_enabled)
              }
              findLabels={{
                title: dict.aiSearch.banner.title,
                titleIndexing: dict.aiSearch.banner.titleIndexing,
                descriptionFace: dict.aiSearch.banner.descriptionFace,
                descriptionBib: dict.aiSearch.banner.descriptionBib,
                descriptionBoth: dict.aiSearch.banner.descriptionBoth,
                descriptionIndexing: dict.aiSearch.banner.descriptionIndexing,
                faceButton: dict.aiSearch.banner.faceButton,
                bibButton: dict.bibDetection.bibButton,
                bibModalTitle: dict.bibDetection.searchModalTitle,
                bibModalDescription: dict.bibDetection.searchModalDescription,
                bibPlaceholder: dict.bibDetection.searchPlaceholder,
                bibSearch: dict.bibDetection.searchButton,
                bibCancel: dict.bibDetection.searchCancel,
                bibClear: dict.bibDetection.searchClear,
                bibFailed: dict.bibDetection.searchFailed,
              }}
              fullGallery={
                <Suspense
                  key="event-gallery"
                  fallback={
                    // Matches PhotoAlbumViewer's real grid (grid-cols-2 gap-2
                    // sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5, aspect-square
                    // tiles) — the previous 3-breakpoint/gap-4 version undercounted
                    // columns at lg and used the wrong gap (T-128).
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                      {Array.from({ length: 15 }).map((_, i) => (
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
                    isCollaborative={event.is_collaborative}
                    initialPhotosInCart={photosInCart}
                    initialPhotosInMyPhotos={photosInMyPhotos}
                    favoriteToastLabels={{
                      added: dict.eventPhotoViewer.addedToPhotos,
                      removed: dict.eventPhotoViewer.removedFromPhotos,
                      failedAdd: dict.eventPhotoViewer.failedAddPhotos,
                      failedRemove: dict.eventPhotoViewer.failedRemovePhotos,
                    }}
                    iconTooltips={dict.photoIconButtons}
                    showAddToCart={showCartUi}
                    emptyText={gated ? dict.events.galleryGatedEmpty : dict.events.galleryEmpty}
                    uploadingLabel={dict.collaborativeEvent.galleryUploadingLabel}
                    uploaderLabels={{
                      tooltip: dict.collaborativeEvent.uploaderTooltip,
                      popoverHeading: dict.collaborativeEvent.uploaderPopoverHeading,
                      guestLabel: dict.collaborativeEvent.uploaderGuestLabel,
                      authenticatedLabel: dict.collaborativeEvent.uploaderAuthenticatedLabel,
                    }}
                    bulkDeleteLabels={{
                      button: dict.events.removeButton,
                      confirmTitle: dict.events.deletePhotosTitle,
                      confirmDesc: dict.events.deletePhotosDesc,
                      confirmButton: dict.events.confirmButton,
                      cancelButton: dict.events.cancelButton,
                      deletingLabel: dict.events.deletingLabel,
                      successToast: dict.events.deletedPhotosToast,
                      skippedToast: dict.events.deletedPhotosSkippedToast,
                      noneEligibleToast: dict.events.deleteNoneEligible,
                      failedToast: dict.events.failedDeletePhotos,
                      photoNoun: dict.events.photo,
                      photosNoun: dict.events.photos,
                    }}
                    cartToastLabels={{
                      failedAdd: dict.eventPhotoViewer.failedAddCart,
                      failedRemove: dict.eventPhotoViewer.failedRemoveCart,
                    }}
                    purchasedPhotoIds={purchasedPhotoIds}
                    bulkDownload={bulkDownloadLabels}
                    filterLabels={{
                      all: dict.collaborativeEvent.myPhotosAll,
                      mine: dict.collaborativeEvent.myPhotosMine,
                      empty: dict.collaborativeEvent.myPhotosEmpty,
                    }}
                    menuLabels={{
                      trigger: dict.events.moreOptions,
                      download: dict.events.download,
                      failed: dict.events.downloadFailed,
                      notPurchased: dict.events.downloadNotPurchased,
                      addToCart: dict.events.addToCartMenuItem,
                      removeFromCart: dict.events.removeFromCartMenuItem,
                      uploadedBy: dict.events.uploadedByMenuLabel,
                    }}
                    resultsLabels={dict.aiSearch.results}
                    imageUnavailableLabel={dict.eventCard.imageUnavailable}
                    // Reveal gate (T-177): the toolbar counter reflects only
                    // what's revealed (the true total lives near the header),
                    // so pre-search it resolves to 0 and the label hides itself.
                    totalCount={gated ? photoItems.length : totalCount}
                    photosCountLabel={dict.events.photosCount}
                    bibSearchEmptyLabel={dict.bibDetection.searchEmpty}
                    initialHasMore={hasMore}
                    loadMoreLabel={dict.events.loadMore}
                    loadMoreErrorLabel={dict.events.loadMoreFailed}
                    photoDetailLabels={dict.photoDetail}
                    locale={lang}
                    photographerName={uploaderProfiles[event.user_id]?.username}
                  />
                </Suspense>
              }
            />
          )}
        </div>
      </UploadProgressProvider>
    </div>
  );
}
