import { CalendarClock } from 'lucide-react';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { getActiveRole } from '@/app/[lang]/actions/roles';
import { ContributeModal } from '@/app/[lang]/events/[shareCode]/contribute-modal';
import { ContributeTriggerCard } from '@/app/[lang]/events/[shareCode]/contribute-trigger-card';
import { UploadProgressProvider } from '@/app/[lang]/events/[shareCode]/upload-progress-provider';
import { DashboardHeader } from '@/components/dashboard-header';
import { EventGalleryWithFaceSearch } from '@/components/event-gallery-with-face-search';
import {
  createPhotoUrls,
  getEventByShareCode,
  getEventBySlug,
  getEventPhotosPublic,
  getPhotoIdsInCart,
} from '@/database/queries';
import {
  getEventAiIndexingProgress,
  getEventRekognitionState,
} from '@/database/queries/rekognition';
import type { SupabaseServerClient } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
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

  const photos = await getEventPhotosPublic(supabaseAdmin, event.id);
  const signed: Record<string, string> = {};

  // Watermark only when BOTH the photographer opted in (`watermark_enabled`)
  // AND the viewer is a talent. Photographers viewing their own events
  // here get clean URLs; events with the watermark setting disabled never
  // watermark even for talents (e.g. free collaborative events).
  const useWatermark = viewerIsTalent && event.watermark_enabled === true;

  const eventStatusInside = getEventStatus(event.date);
  if (eventStatusInside !== 'upcoming') {
    const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);
    if (paths.length > 0) {
      const photoUrls = await createPhotoUrls(supabaseAdmin, 'photos', paths, {
        expiresIn: 60 * 60,
        useWatermark,
        baseUrl,
      });
      for (const item of photoUrls) {
        if (item.signedUrl) signed[item.path] = item.signedUrl;
      }
    }
  }

  return { event, photos, signed };
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

  let activeRole: string | null = null;
  if (user) {
    try {
      activeRole = (await getActiveRole()).activeRole ?? null;
    } catch {
      activeRole = null;
    }
  }
  const viewerIsTalent = activeRole === 'talent';

  const cached = await getCachedTalentEventData(param, baseUrl, viewerIsTalent);
  if (!cached) notFound();
  const { event, photos, signed } = cached;

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

  // Per-user state — fetched fresh on every request (intentional). Batched
  // into one query each instead of looping isPhotoInCart per photo.
  const photosInCart: string[] = [];
  const photosInMyPhotos: string[] = [];
  if (user && eventStatus !== 'upcoming' && activeRole === 'talent') {
    const photoIds = photos.map((p) => p.id);
    if (photoIds.length > 0) {
      const [cartIds, tagsResult] = await Promise.all([
        getPhotoIdsInCart(supabase, user.id, photoIds),
        supabase
          .from('talent_photo_tags')
          .select('photo_id')
          .eq('talent_user_id', user.id)
          .in('photo_id', photoIds),
      ]);
      for (const id of cartIds) photosInCart.push(id);
      for (const tag of tagsResult.data ?? []) photosInMyPhotos.push(tag.photo_id);
    }
  }

  const photoItems = photos
    .map((p) => {
      const url = p.original_url ? signed[p.original_url] : null;
      if (!url) return null;
      return {
        id: p.id,
        url,
        alt: p.original_url || `Photo from ${event.name}`,
      };
    })
    .filter(
      (
        item,
      ): item is {
        id: string;
        url: string;
        alt: string;
      } => item !== null,
    );

  // Render the page body. We wrap in <UploadProgressProvider> ONLY when
  // contribute is relevant — non-collaborative events don't need the
  // in-flight upload modal infrastructure. The provider supplies labels +
  // owns the progress dialog that `ContributeModal` triggers indirectly.
  const body = (
    <div className="space-y-4">
      <div>
        <DashboardHeader title={event.name} />
        <div className="text-sm text-muted-foreground">
          {new Date(event.date).toDateString().split(' ').slice(1).join(' ')} •{' '}
          {event.city[0]?.toUpperCase() + event.city.slice(1)}
          {event.price_per_photo !== null && (
            <>
              {' '}
              • ${event.price_per_photo.toFixed(2)} {dict.talentDashboard.perPhoto}
            </>
          )}
        </div>
      </div>

      {/* Contribute affordance — collaborative events with guest-upload on,
          the day-of-event window open, and a share code in hand. Lives
          ABOVE the gallery so it's the first thing a talent sees when they
          land here with a code. */}
      {showContribute && event.share_code ? (
        <div className="mb-2">
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
            photos={photoItems}
            shareCode={event.share_code ?? event.id}
            aiSearchEligible={aiSearchEligible}
            aiState={aiBannerState}
            bannerLabels={dict.aiSearch.banner}
            modalLabels={dict.aiSearch.modal}
            resultsLabels={dict.aiSearch.results}
            iconTooltips={dict.photoIconButtons}
            imageUnavailableLabel={dict.eventCard.imageUnavailable}
            fullGallery={
              <TranslationsProvider translations={dict.eventPhotoViewer}>
                <EventPhotoViewer
                  items={photoItems}
                  showAddToCart={user !== null}
                  photosInCart={new Set(photosInCart)}
                  photosInMyPhotos={new Set(photosInMyPhotos)}
                  iconTooltips={dict.photoIconButtons}
                  imageUnavailableLabel={dict.eventCard.imageUnavailable}
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
