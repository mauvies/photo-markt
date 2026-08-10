import { CalendarClock } from 'lucide-react';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { userHasRole } from '@/app/[lang]/actions/roles';
import { ContributeDialog } from '@/app/[lang]/events/[shareCode]/contribute-dialog';
import { buildPublicPhotoAlbumItem } from '@/app/[lang]/events/[shareCode]/photo-album-item';
import { UploadProgressProvider } from '@/app/[lang]/events/[shareCode]/upload-progress-provider';
import { DashboardHeader } from '@/components/dashboard-header';
import { EventGalleryWithFaceSearch } from '@/components/event-gallery-with-face-search';
import { EventMetaLine } from '@/components/event-meta-line';
import { EventPricingSection } from '@/components/event-pricing-section';
import { EventSaveButton } from '@/components/event-save-button';
import { EventShareButton } from '@/components/event-share-button';
import { GatedSearchPanel } from '@/components/gated-search-panel';
import { MarkEventSeen } from '@/components/mark-event-seen';
import {
  countEventPhotosByStatus,
  createPhotoUrlMap,
  getEventByShareCode,
  getEventBySlug,
  getEventPhotosPublicByIds,
  getEventPhotosPublicPage,
  getPhotoIdsInCart,
  getProfilesByIds,
  getUploadedPhotoIdsForUserInEvent,
  type PhotoDetail,
} from '@/database/queries';
import { eventHasAnyBibNumbers } from '@/database/queries/bib-numbers';
import { getPurchasedPhotoIdsForEvent } from '@/database/queries/orders';
import {
  getEventAiIndexingProgress,
  getEventRekognitionState,
} from '@/database/queries/rekognition';
import { getClaimedPhotoIdsForTalent } from '@/database/queries/talent-library';
import type { SupabaseServerClient } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { parseBundleTiers } from '@/lib/bundle-pricing';
import { eventDetailCacheTags } from '@/lib/event-cache-tags';
import { EVENT_GALLERY_PAGE_SIZE } from '@/lib/event-gallery';
import { getEventStatus, isCollaborativeUploadOpen } from '@/lib/event-status';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { resolveGatedFaceSearchNotice } from '@/lib/find-my-photos';
import { getBaseUrl } from '@/lib/get-base-url';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { needsProtectedPreview } from '@/lib/preview-protection';
import { getProvenRevealIds } from '@/lib/reveal-gate';
import { isEventRevealGated } from '@/lib/reveal-token';
import { EventPhotoViewer } from './event-photo-viewer';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Caches the event-public slice of this page (event row + photos + signed
// URLs). User-specific bits (cart membership, photo tags) are computed
// AFTER this returns, so no per-user data crosses the cache boundary.
//
// `viewerIsTalent` participates in the cache key — two cache entries per
// event (protected vs not). The actual protection decision is the
// intersection of `needsProtectedPreview(event)` (watermarked OR for-sale,
// T-136) AND `viewerIsTalent` (only talents see the preview-grade image;
// photographers see the original even on this route). Genuinely free
// (null-price) events with `watermark_enabled=false` always serve clean
// photos regardless of viewer role — that was the bug the user reported on
// event `2YNNZY6F`.
//
// Cache invalidated by photographer photo mutations via revalidateTag('event-<id>').
async function getCachedTalentEventData(param: string, baseUrl: string, viewerIsTalent: boolean) {
  'use cache';
  cacheTag(...eventDetailCacheTags(param));
  // 55 min — safely under the 60-min signed URL expiry
  cacheLife({ revalidate: 55 * 60, expire: 55 * 60 });

  // Cascade lookup mirroring `/events/[shareCode]/page.tsx`:
  //   1. UUID  → direct id lookup, public events only.
  //   2. Slug  → SEO slug lookup, public events only.
  //   3. Share code → no `is_public` filter so collaborative private events
  //      are reachable by talents who entered the code via the explore
  //      search bar. Without this branch the route would 404 for any
  //      private collab event and the search-bar redirect would have to
  //      bounce talents out of the dashboard chrome.
  let event: Awaited<ReturnType<typeof getEventBySlug>> = null;
  if (UUID_REGEX.test(param)) {
    const { data } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('id', param)
      .eq('is_public', true)
      .is('deleted_at', null)
      .maybeSingle();
    event = (data as typeof event) ?? null;
  } else {
    const bySlug = await getEventBySlug(supabaseAdmin, param);
    if (bySlug) {
      event = bySlug;
    } else {
      // Share-code fallback. `getEventByShareCode` filters out soft-deleted
      // rows; no is_public filter here is intentional — the code itself
      // is the access credential.
      const byShareCode = await getEventByShareCode(supabaseAdmin, param);
      if (byShareCode) event = byShareCode;
    }
  }

  if (!event) return null;

  // Reveal gate (T-177): a gated event ships no browsable gallery — its photos
  // are revealed only through face search. Skip the page fetch so no photo
  // record is cached/shipped to an unproven talent; the revealed set is fetched
  // per-request (keyed on the proof cookie) in the page body.
  const gated = isEventRevealGated(event);

  // Only the first gallery page is fetched + signed up front; "Load more"
  // fetches the rest via a Server Action. `totalCount` is the true approved
  // total (same count the public page uses), threaded to the toolbar count.
  const [{ photos, hasMore }, totalCount] = await Promise.all([
    gated
      ? Promise.resolve({ photos: [] as PhotoDetail[], hasMore: false })
      : getEventPhotosPublicPage(supabaseAdmin, event.id, {
          limit: EVENT_GALLERY_PAGE_SIZE,
          offset: 0,
        }),
    countEventPhotosByStatus(supabaseAdmin, event.id, ['approved']),
  ]);

  // Protect only when BOTH the event has something to protect — watermarked
  // OR sellable (`needsProtectedPreview`, T-136; shared with the cart
  // resolver) — AND the viewer is a talent. Photographers viewing their own
  // events here get clean URLs; genuinely free un-watermarked events (e.g.
  // free collaborative events) keep the direct sign even for talents.
  const useWatermark = viewerIsTalent && needsProtectedPreview(event);

  const eventStatusInside = getEventStatus(event.date);
  const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);
  const signed =
    eventStatusInside === 'upcoming'
      ? {}
      : await createPhotoUrlMap(supabaseAdmin, 'photos', paths, {
          expiresIn: 60 * 60,
          useWatermark,
          baseUrl,
        });

  return { event, photos, hasMore, totalCount, signed };
}

export default async function ExploreEventDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id: param } = await params;
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();
  const baseUrl = await getBaseUrl();

  // Auth + role lookup runs per-request (cookies can't be inside 'use cache')
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Capability, not active view: a talent-capable user sees their cart/purchase
  // state here regardless of which dashboard they last switched to.
  let viewerIsTalent = false;
  if (user) {
    try {
      viewerIsTalent = await userHasRole('talent');
    } catch {
      // Fail CLOSED: `viewerIsTalent` gates preview protection below, and the
      // 'use cache' entry is keyed on it — a transient role-lookup error must
      // not compute (and cache for 55 min) the unprotected variant with
      // direct signed originals. Worst case a photographer briefly sees the
      // talent (preview-grade) view.
      viewerIsTalent = true;
    }
  }

  const cached = await getCachedTalentEventData(param, baseUrl, viewerIsTalent);
  if (!cached) notFound();
  const { event, hasMore, totalCount } = cached;
  // Reveal gate (T-177): the cached loader ships no photos for a gated event;
  // substitute the proven set per-request below when a valid proof cookie is present.
  let photos = cached.photos;
  let signed = cached.signed;

  const eventStatus = getEventStatus(event.date);

  // Volume pricing (T-204), parsed ONCE for every surface on this page — meta
  // line, pricing section and the viewer — so they cannot disagree about the
  // same event's ladder, and so this view cannot disagree with the public page.
  const bundleTiers = parseBundleTiers((event as unknown as Record<string, unknown>).bundle_tiers);
  const bundleAllPhotosCents =
    ((event as unknown as Record<string, unknown>).bundle_all_photos_cents as number | null) ??
    null;
  const bundleLabels = {
    allPhotos: dict.bundlePricing.offerAllPhotos,
    tier: dict.bundlePricing.offerTier,
    selectionTotal: dict.bundlePricing.selectionTotal,
    selectionNextTier: dict.bundlePricing.selectionNextTier,
    addAllMyPhotos: dict.bundlePricing.addAllMyPhotos,
  };

  const gated = isEventRevealGated(event);
  if (gated && eventStatus !== 'upcoming') {
    const provenIds = await getProvenRevealIds(event.id);
    if (provenIds.size > 0) {
      const useWatermark = viewerIsTalent && needsProtectedPreview(event);
      const revealedPhotos = await getEventPhotosPublicByIds(
        supabaseAdmin,
        event.id,
        Array.from(provenIds),
      );
      const paths = revealedPhotos
        .map((p) => p.original_url)
        .filter((url): url is string => url !== null);
      photos = revealedPhotos;
      signed = await createPhotoUrlMap(supabaseAdmin, 'photos', paths, {
        expiresIn: 60 * 60,
        useWatermark,
        baseUrl,
      });
    }
  }

  // Collaborative-upload eligibility — mirrors `/events/[shareCode]/page.tsx`.
  // When a talent reaches a collaborative event via share-code lookup,
  // they expect to be able to contribute their own photos. Without this
  // block the dashboard view was read-only, which is what the user
  // reported when they got here via `2YNNZY6F`.
  const isCollaborativeShareable =
    event.is_collaborative && event.allow_guest_upload && Boolean(event.share_code);
  const uploadOpen = isCollaborativeUploadOpen(event.date);
  const showContribute = isCollaborativeShareable && uploadOpen;
  const showContributeLockedNotice = isCollaborativeShareable && !uploadOpen;

  // AI face search eligibility — same predicate as `/events/[shareCode]`.
  // Banner only renders when AI is enabled, the event isn't flagged as
  // containing minors, the collection exists, indexing hasn't terminally
  // failed, and at least one photo has been processed.
  let aiSearchEligible = false;
  let aiBannerState: 'ready' | 'indexing' = 'ready';
  // `aiUsable` / `aiStatus` feed the reveal-gate dead-end guard (T-184): a
  // gated event with no searchable face index yet must show a clear state, not
  // a mute empty gallery.
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
      // Best-effort; banner just won't render on failure.
    }
  }

  // Reveal gate (T-177) dead-end guard (T-184): when the event is gated but face
  // search can't render yet, show a clear "processing / unavailable" state
  // instead of stranding the visitor with no photos and no way to search.
  const gatedFaceSearchNotice = resolveGatedFaceSearchNotice({
    gated,
    aiSearchEligible,
    aiUsable,
    aiStatus,
  });
  // Gated pre-search panel copy (T-230) — resolved once for both the page (the
  // processing / unavailable states) and the viewer (the searchable one), and
  // mirroring the public page exactly.
  const gatedPanelLabels = dict.aiSearch.gatedPanel;
  // The panel carries the event total itself, so the header line below drops
  // its own copy of it while the panel owns the gallery slot.
  const gatedPanelOwnsGallery =
    gated &&
    eventStatus !== 'upcoming' &&
    (gatedFaceSearchNotice !== 'none' || photos.length === 0);

  // Whether the event has any detected bib numbers yet — drives the bib search
  // empty state ("still processing" vs "no match"). Only relevant when bib
  // detection is enabled; best-effort (defaults to false).
  let bibHasData = false;
  const bibDetectionEnabled = Boolean(
    (event as unknown as Record<string, unknown>).bib_detection_enabled,
  );
  if (bibDetectionEnabled) {
    try {
      bibHasData = await eventHasAnyBibNumbers(
        supabaseAdmin as unknown as SupabaseServerClient,
        event.id,
      );
    } catch {
      // Best-effort; empty state just defaults to the "processing" copy.
    }
  }

  // Per-user state — fetched fresh on every request (intentional). Batched
  // into one query each instead of looping isPhotoInCart per photo.
  const photosInCart: string[] = [];
  const photosInMyPhotos: string[] = [];
  const photosClaimedToProfile: string[] = [];
  // Photos this talent has purchased — gates the bulk download on paid events.
  let purchasedPhotoIds = new Set<string>();
  if (user && eventStatus !== 'upcoming' && viewerIsTalent) {
    const photoIds = photos.map((p) => p.id);
    if (photoIds.length > 0) {
      const [cartIds, tagsResult, claimedIds] = await Promise.all([
        getPhotoIdsInCart(supabase, user.id, photoIds),
        supabase
          .from('talent_photo_tags')
          .select('photo_id')
          .eq('talent_user_id', user.id)
          .in('photo_id', photoIds),
        getClaimedPhotoIdsForTalent(supabase, user.id, photoIds),
      ]);
      for (const id of cartIds) photosInCart.push(id);
      for (const tag of tagsResult.data ?? []) photosInMyPhotos.push(tag.photo_id);
      for (const id of claimedIds) photosClaimedToProfile.push(id);
      // Free events are downloadable by anyone — only paid events need this.
      if (event.price_per_photo !== null) {
        purchasedPhotoIds = await getPurchasedPhotoIdsForEvent(supabase, user.id, event.id);
      }
    }
  }

  // Uploader display names (collaborative attribution) and the talent's own
  // uploaded-photo ids are independent — resolve them together. `uploadedPhotoIds`
  // must be the COMPLETE set (not first-page-derived) so a "My photos" match
  // beyond the loaded grid still resolves (R5).
  const [uploaderProfiles, uploadedPhotoIds] = await Promise.all([
    // Always resolve the owner profile (the purchase modal shows the
    // photographer's name); collaborative events also resolve per-upload
    // contributors for the grid badge.
    getProfilesByIds(
      supabaseAdmin,
      Array.from(
        new Set([
          event.user_id,
          ...(event.is_collaborative
            ? photos
                .map((p) => (p as { uploaded_by?: string | null }).uploaded_by)
                .filter((v): v is string => Boolean(v))
            : []),
        ]),
      ),
    ),
    user
      ? getUploadedPhotoIdsForUserInEvent(supabaseAdmin, event.id, user.id)
      : Promise.resolve<string[]>([]),
  ]);

  // Public URL for the Share icon — must resolve for anyone, even without an
  // account, so it always points at /events/[shareCode-or-slug], never the
  // dashboard route. Share code first (works for private collaborative
  // events too), then slug, then id as a last resort.
  const eventPublicUrl = `${getSiteUrl()}/${lang}/events/${event.share_code ?? event.slug ?? event.id}`;

  const galleryAlt = `Photo from ${event.name}`;
  const photoItems = photos
    .map((p) => buildPublicPhotoAlbumItem(p, { signed, event, uploaderProfiles, alt: galleryAlt }))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const myUploadedPhotoIds = new Set<string>(uploadedPhotoIds);

  const isFreeEvent = event.price_per_photo === null;
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

  // Render the page body. We wrap in <UploadProgressProvider> ONLY when
  // contribute is relevant — non-collaborative events don't need the
  // in-flight upload modal infrastructure. The provider supplies labels +
  // owns the progress dialog that `ContributeDialog` triggers indirectly.
  const body = (
    <div className="space-y-4">
      <MarkEventSeen eventId={event.id} />
      <div>
        <DashboardHeader
          title={event.name}
          actions={
            <div className="flex items-center gap-1">
              <EventSaveButton eventId={event.id} variant="icon" />
              <EventShareButton
                eventName={event.name}
                eventUrl={eventPublicUrl}
                tooltip={dict.eventShare.tooltip}
              />
            </div>
          }
        />
        <EventMetaLine
          date={event.date}
          sessionTime={event.session_time}
          sessionEndTime={event.session_end_time}
          city={event.city}
          state={event.state}
          country={event.country}
          locale={lang}
          perPhotoLabel={dict.talentDashboard.perPhoto}
          pricePerPhoto={event.price_per_photo}
          bundleTiers={bundleTiers}
          bundleAllPhotosCents={bundleAllPhotosCents}
          photographerName={uploaderProfiles[event.user_id]?.username}
        />
        {/* Reveal gate (T-177): total near the header (worth searching); the
            toolbar counter below reflects only what's revealed. Dropped while
            the gated panel renders (T-230) — it states the same total, and
            printing it twice on one screen reads as a bug. */}
        {gated && eventStatus !== 'upcoming' && !gatedPanelOwnsGallery ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {dict.events.photosInEvent.replace('{n}', String(totalCount))}
          </p>
        ) : null}
      </div>

      {/* Volume pricing (T-203, D17) — the SAME slot the public event page
          uses, so the two views can't quote different prices for one event. */}
      <EventPricingSection
        className="mb-6"
        pricePerPhoto={event.price_per_photo}
        bundleTiers={bundleTiers}
        bundleAllPhotosCents={bundleAllPhotosCents}
        labels={{
          heading: dict.bundlePricing.heading,
          singlePhoto: dict.bundlePricing.singlePhoto,
          photosOrMore: dict.bundlePricing.photosOrMore,
          eachSuffix: dict.bundlePricing.eachSuffix,
          ladderHint: dict.bundlePricing.ladderHint,
          allPhotos: dict.bundlePricing.allPhotos,
        }}
      />

      {/* Contribute affordance — collaborative events with guest-upload on,
          the day-of-event window open, and a share code in hand. Lives
          ABOVE the gallery so it's the first thing a talent sees when they
          land here with a code. */}
      {showContribute && event.share_code ? (
        <div className="mb-2">
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
        <div className="mb-2 rounded-lg border border-dashed border-input bg-muted/30 p-4 text-sm text-muted-foreground">
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
        // Reveal gate (T-177) dead-end guard (T-184): the event is gated but has
        // no searchable face index yet, so the face-search entry can't render.
        // Show a clear state instead of a mute empty gallery with no way out —
        // the same panel as the searchable state (T-230), so all three
        // pre-search states carry equal visual weight.
        <GatedSearchPanel
          state={gatedFaceSearchNotice}
          labels={gatedPanelLabels}
          photoCount={totalCount}
        />
      ) : photoItems.length === 0 && !gated ? (
        // Reveal gate (T-177): a gated event ALWAYS renders the gallery wrapper
        // below so the face-search entry mounts — logged-in talents are
        // redirected here from the public page, so this is their only way to
        // search. Without this guard an unproven talent hits the empty state
        // and can never reveal their photos.
        <div className="text-center py-12">
          <p className="text-muted-foreground">{dict.talentDashboard.noPhotosAvailable}</p>
        </div>
      ) : (
        <div className="w-full space-y-3">
          <EventGalleryWithFaceSearch
            shareCode={event.share_code ?? event.id}
            aiSearchEligible={aiSearchEligible}
            revealGated={gated}
            aiState={aiBannerState}
            modalLabels={dict.aiSearch.modal}
            bibDetectionEnabled={
              // Reveal gate (T-177): v1 unlocks by face only — never bib.
              !gated && Boolean((event as unknown as Record<string, unknown>).bib_detection_enabled)
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
              <TranslationsProvider translations={dict.eventPhotoViewer}>
                <EventPhotoViewer
                  items={photoItems}
                  eventId={event.id}
                  isFreeEvent={isFreeEvent}
                  purchasedPhotoIds={purchasedPhotoIds}
                  isCollaborative={event.is_collaborative}
                  shareCode={event.share_code ?? null}
                  uploadedPhotoIds={myUploadedPhotoIds}
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
                  filterLabels={{
                    all: dict.collaborativeEvent.myPhotosAll,
                    mine: dict.collaborativeEvent.myPhotosMine,
                    empty: dict.collaborativeEvent.myPhotosEmpty,
                  }}
                  gatedPanel={
                    gated ? { labels: gatedPanelLabels, photoCount: totalCount } : undefined
                  }
                  bibHasData={bibHasData}
                  bibEmptyLabels={{
                    pending: dict.bibDetection.searchEmptyPending,
                    noMatch: dict.bibDetection.searchEmptyNoMatch,
                  }}
                  menuLabels={{
                    trigger: dict.events.moreOptions,
                    download: dict.events.download,
                    addToFavorites: dict.events.addToFavorites,
                    removeFromFavorites: dict.events.removeFromFavorites,
                    addToProfile: dict.events.addToProfile,
                    addedToProfile: dict.events.addedToProfile,
                    addToCart: dict.events.addToCartMenuItem,
                    removeFromCart: dict.events.removeFromCartMenuItem,
                    uploadedBy: dict.events.uploadedByMenuLabel,
                    downloadFailed: dict.events.downloadFailed,
                    downloadNotPurchased: dict.events.downloadNotPurchased,
                  }}
                  resultsLabels={dict.aiSearch.results}
                  bulkDownload={bulkDownloadLabels}
                  showAddToCart={!isFreeEvent}
                  photosInCart={new Set(photosInCart)}
                  photosInMyPhotos={new Set(photosInMyPhotos)}
                  photosClaimedToProfile={new Set(photosClaimedToProfile)}
                  iconTooltips={dict.photoIconButtons}
                  imageUnavailableLabel={dict.eventCard.imageUnavailable}
                  // Reveal gate (T-177): toolbar counter reflects only what's
                  // revealed (true total lives near the header).
                  totalCount={gated ? photos.length : totalCount}
                  photosCountLabel={dict.events.photosCount}
                  initialHasMore={hasMore}
                  loadMoreLabel={dict.events.loadMore}
                  loadMoreErrorLabel={dict.events.loadMoreFailed}
                  pricePerPhoto={event.price_per_photo}
                  bundleTiers={bundleTiers}
                  bundleAllPhotosCents={bundleAllPhotosCents}
                  bundleLabels={bundleLabels}
                  photoDetailLabels={dict.photoDetail}
                  locale={lang}
                  photographerName={uploaderProfiles[event.user_id]?.username}
                />
              </TranslationsProvider>
            }
          />
        </div>
      )}
    </div>
  );

  if (!showContribute) return body;

  return (
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
      {body}
    </UploadProgressProvider>
  );
}
