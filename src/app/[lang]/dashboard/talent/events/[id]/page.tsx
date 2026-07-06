import { CalendarClock } from 'lucide-react';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { userHasRole } from '@/app/[lang]/actions/roles';
import { ContributeDialog } from '@/app/[lang]/events/[shareCode]/contribute-dialog';
import {
  buildPublicPhotoAlbumItem,
  type UploaderProfileMap,
} from '@/app/[lang]/events/[shareCode]/photo-album-item';
import { UploadProgressProvider } from '@/app/[lang]/events/[shareCode]/upload-progress-provider';
import { DashboardHeader } from '@/components/dashboard-header';
import { EventGalleryWithFaceSearch } from '@/components/event-gallery-with-face-search';
import { EventSaveButton } from '@/components/event-save-button';
import { MarkEventSeen } from '@/components/mark-event-seen';
import {
  createPhotoUrlMap,
  getEventByShareCode,
  getEventBySlug,
  getEventPhotosPublicPage,
  getPhotoIdsInCart,
  getProfilesByIds,
  getUploadedPhotoIdsForUserInEvent,
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
import { EVENT_GALLERY_PAGE_SIZE } from '@/lib/event-gallery';
import { getEventStatus, isCollaborativeUploadOpen } from '@/lib/event-status';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { getBaseUrl } from '@/lib/get-base-url';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { EventPhotoViewer } from './event-photo-viewer';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Caches the event-public slice of this page (event row + photos + signed
// URLs). User-specific bits (cart membership, photo tags) are computed
// AFTER this returns, so no per-user data crosses the cache boundary.
//
// `viewerIsTalent` participates in the cache key — two cache entries per
// event (watermarked vs not). The actual watermark decision is the
// intersection of `event.watermark_enabled` (photographer's setting) AND
// `viewerIsTalent` (only talents see the preview-grade image; photographers
// see the original even on this route). Free collaborative events with
// `watermark_enabled=false` always serve clean photos regardless of viewer
// role — that was the bug the user reported on event `2YNNZY6F`.
//
// Cache invalidated by photographer photo mutations via revalidateTag('event-<id>').
async function getCachedTalentEventData(param: string, baseUrl: string, viewerIsTalent: boolean) {
  'use cache';
  cacheTag(`event-${param}`, 'events-public');
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

  // Only the first gallery page is fetched + signed up front; "Load more"
  // fetches the rest via a Server Action.
  const { photos, hasMore } = await getEventPhotosPublicPage(supabaseAdmin, event.id, {
    limit: EVENT_GALLERY_PAGE_SIZE,
    offset: 0,
  });

  // Watermark only when BOTH the photographer opted in (`watermark_enabled`)
  // AND the viewer is a talent. Photographers viewing their own events
  // here get clean URLs; events with the watermark setting disabled never
  // watermark even for talents (e.g. free collaborative events).
  const useWatermark = viewerIsTalent && event.watermark_enabled === true;

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

  return { event, photos, hasMore, signed };
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
      viewerIsTalent = false;
    }
  }

  const cached = await getCachedTalentEventData(param, baseUrl, viewerIsTalent);
  if (!cached) notFound();
  const { event, photos, hasMore, signed } = cached;

  const eventStatus = getEventStatus(event.date);

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
      // Best-effort; banner just won't render on failure.
    }
  }

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
    event.is_collaborative
      ? getProfilesByIds(
          supabaseAdmin,
          Array.from(
            new Set([
              event.user_id,
              ...photos
                .map((p) => (p as { uploaded_by?: string | null }).uploaded_by)
                .filter((v): v is string => Boolean(v)),
            ]),
          ),
        )
      : Promise.resolve<UploaderProfileMap>({}),
    user
      ? getUploadedPhotoIdsForUserInEvent(supabaseAdmin, event.id, user.id)
      : Promise.resolve<string[]>([]),
  ]);

  const galleryAlt = `Photo from ${event.name}`;
  const photoItems = photos
    .map((p) => buildPublicPhotoAlbumItem(p, { signed, event, uploaderProfiles, alt: galleryAlt }))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const myUploadedPhotoIds = new Set<string>(uploadedPhotoIds);

  const isFreeEvent = event.price_per_photo === null;
  const bulkDownloadLabels = {
    select: dict.events.selectButton,
    clear: dict.events.clearButton,
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
        <DashboardHeader title={event.name} />
        <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {new Date(event.date).toDateString().split(' ').slice(1).join(' ')} •{' '}
          {event.city[0]?.toUpperCase() + event.city.slice(1)}
          {event.price_per_photo !== null && (
            <>
              {' '}
              • ${event.price_per_photo.toFixed(2)} {dict.talentDashboard.perPhoto}
            </>
          )}
        </div>
        <div className="mt-3">
          <EventSaveButton eventId={event.id} variant="button" />
        </div>
      </div>

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
      ) : photoItems.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">{dict.talentDashboard.noPhotosAvailable}</p>
        </div>
      ) : (
        <div className="w-full space-y-3">
          <EventGalleryWithFaceSearch
            shareCode={event.share_code ?? event.id}
            aiSearchEligible={aiSearchEligible}
            aiState={aiBannerState}
            bannerLabels={dict.aiSearch.banner}
            modalLabels={dict.aiSearch.modal}
            bibDetectionEnabled={Boolean(
              (event as unknown as Record<string, unknown>).bib_detection_enabled,
            )}
            bibSearchLabels={{
              title: dict.bibDetection.searchTitle,
              placeholder: dict.bibDetection.searchPlaceholder,
              button: dict.bibDetection.searchButton,
              clear: dict.bibDetection.searchClear,
              failed: dict.bibDetection.searchFailed,
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
                  initialHasMore={hasMore}
                  loadMoreLabel={dict.events.loadMore}
                  loadMoreErrorLabel={dict.events.loadMoreFailed}
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
