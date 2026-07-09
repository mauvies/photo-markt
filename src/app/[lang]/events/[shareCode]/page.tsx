import { CalendarClock } from 'lucide-react';
import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getActiveRole } from '@/app/[lang]/actions/roles';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { EventGalleryWithFaceSearch } from '@/components/event-gallery-with-face-search';
import {
  countEventPhotosByStatus,
  createPhotoUrlMap,
  getEventByShareCode,
  getEventBySlug,
  getEventPhotosPublicPage,
  getProfilesByIds,
  type PhotoDetail,
  type SupabaseServerClient,
} from '@/database/queries';
import { getPurchasedPhotoIdsForEvent } from '@/database/queries/orders';
import {
  getEventAiIndexingProgress,
  getEventRekognitionState,
} from '@/database/queries/rekognition';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { EVENT_GALLERY_PAGE_SIZE } from '@/lib/event-gallery';
import { getEventStatus, isCollaborativeUploadOpen } from '@/lib/event-status';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { getBaseUrl } from '@/lib/get-base-url';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Locale } from '@/lib/i18n/config';
import { locales } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { stringifyJsonLd } from '@/lib/json-ld';
import { ContributeDialog } from './contribute-dialog';
import { buildPublicPhotoAlbumItem, type UploaderProfileMap } from './photo-album-item';
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

  const adminForPhotos = supabaseAdmin as unknown as SupabaseServerClient;
  const eventStatusInside = getEventStatus(event.date);
  // Dedicated cover image (T-055), if any — signed un-watermarked (it's a chosen
  // presentation image, not a for-sale photo) so the JSON-LD can prefer it.
  const coverPath = (event as { cover_path?: string | null }).cover_path ?? null;

  // Round 1 — the first gallery page (only the first page is fetched + signed;
  // a 264-photo event used to sign all 264), the true approved count, and the
  // cover signature are mutually independent (each needs only the event).
  const [{ photos, hasMore }, totalCount, coverSignedUrl] = await Promise.all([
    getEventPhotosPublicPage(adminForPhotos, event.id, {
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
          useWatermark: event.watermark_enabled === true,
          baseUrl,
        })
      : Promise.resolve<Record<string, string>>({}),
    getProfilesByIds(adminForPhotos, uploaderUserIds),
  ]);

  return { event, photos, hasMore, totalCount, signed, uploaderProfiles, coverSignedUrl };
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
  // Prefer the dedicated cover image (T-055) — this is the presentation image
  // the photographer chose, and social/SEO previews are exactly where it
  // matters most. Fall back to the first photo when no cover is set.
  let ogImagePath = (event as { cover_path?: string | null }).cover_path ?? null;
  if (!ogImagePath) {
    const { data: firstPhotoRow } = await supabaseAdmin
      .from('photos')
      .select('original_url')
      .eq('event_id', event.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    ogImagePath = firstPhotoRow?.original_url ?? null;
  }

  if (ogImagePath) {
    const { data: signedData } = await supabaseAdmin.storage
      .from('photos')
      .createSignedUrl(ogImagePath, 60 * 60 * 24);
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
  const { event, photos, hasMore, totalCount, signed, uploaderProfiles, coverSignedUrl } = cached;

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
  // AI face search eligibility — computed server-side. We hide the banner
  // entirely for events that can't surface useful results: AI disabled,
  // contains_minors, failed indexing, or nothing indexed yet (counter at 0).
  // The wrapper component handles the matches-view state purely client-side.
  let aiSearchEligible = false;
  let aiBannerState: 'ready' | 'indexing' = 'ready';
  if (isFeatureEnabled('AI_MATCHING')) {
    try {
      const adminClientForAi = supabaseAdmin as unknown as SupabaseServerClient;
      const aiState = await getEventRekognitionState(adminClientForAi, event.id);
      if (
        aiState?.enabled &&
        !aiState.containsMinors &&
        aiState.collectionId &&
        aiState.status !== 'failed'
      ) {
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
  const location = [event.city, event.country].filter(Boolean).join(', ');

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
  // the first photo.
  const coverUrl = coverSignedUrl ?? photoItems[0]?.url ?? null;

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
        <div className="mx-auto max-w-7xl w-full flex-1 px-4 py-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">{event.name}</h1>
              <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
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
          ) : (
            <EventGalleryWithFaceSearch
              shareCode={event.share_code ?? event.id}
              aiSearchEligible={aiSearchEligible}
              aiState={aiBannerState}
              modalLabels={dict.aiSearch.modal}
              bibDetectionEnabled={Boolean(
                (event as unknown as Record<string, unknown>).bib_detection_enabled,
              )}
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
                    isCollaborative={event.is_collaborative}
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
