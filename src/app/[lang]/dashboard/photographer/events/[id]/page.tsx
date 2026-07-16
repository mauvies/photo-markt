import { DashboardHeader } from '@/components/dashboard-header';
import { EventShareCode } from '@/components/event-share-code';
import {
  countEventPhotos,
  createPhotoUrlMap,
  getEvent,
  getEventPhotographers,
  getEventPhotos,
  getEventPhotosPage,
  getProfilesByIds,
  isApprovedEventPhotographer,
  type SupabaseServerClient,
} from '@/database/queries';
import { type AiMatchingStatus, getEventAiIndexingProgress } from '@/database/queries/rekognition';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';
import { EVENT_GALLERY_PAGE_SIZE } from '@/lib/event-gallery';
import { eventUsesModerationQueue } from '@/lib/event-status';
import { formatEventLocation } from '@/lib/format-location';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { getPhotoTags } from './actions';
import { AiStatusCard } from './ai-status-card';
import { EventActionsMenu } from './event-actions-menu';
import { EventDetailsCard } from './event-details-card';
import { EventModerationTabs } from './event-moderation-tabs';
import { EventPhotoAlbum } from './event-photo-album';
import { OrganizerUploadSection } from './organizer-upload-section';
import { buildOwnerPhotoAlbumItem } from './owner-album-item';
import { PhotographersSection } from './photographers-section';
import { RejectedToast } from './rejected-toast';

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ uploaded?: string }>;
}) {
  const { lang, id } = await params;
  // `uploaded` is the count of photos the client attached in the previous
  // wizard/edit submit. If the worker later rejects any of those (invalid
  // bytes, size-mismatch), the rendered grid will show fewer than `uploaded`
  // — `RejectedToast` does the diff and fires a single toast.
  const { uploaded: uploadedParam } = await searchParams;
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return redirectToLogin();

  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

  // Two roles can view this page: the event owner, and an accepted contributor
  // photographer for organizer events. We resolve the role here once.
  const ownEvent = await getEvent(supabase, id, user.id);
  let event = ownEvent;
  let role: 'owner' | 'contributor' = 'owner';
  if (!event) {
    const isContributor = await isApprovedEventPhotographer(supabase, {
      eventId: id,
      photographerId: user.id,
    });
    if (!isContributor) {
      return localizedRedirect(lang, '/dashboard/photographer/events');
    }
    const { data } = await adminClient
      .from('events')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!data) return localizedRedirect(lang, '/dashboard/photographer/events');
    event = data as typeof event;
    role = 'contributor';
  }

  // Contributor view is intentionally minimal: header + upload entry. The
  // contributor can browse their own uploads from /dashboard/photographer/events.
  if (role === 'contributor' && event) {
    return (
      <div>
        <DashboardHeader title={event.name} />
        <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {new Date(event.date).toDateString().split(' ').slice(1).join(' ')} •{' '}
          {formatEventLocation({ city: event.city, state: event.state, country: event.country })}
        </div>
        <div className="mt-4">
          <TranslationsProvider translations={dict.organizerEvent}>
            <OrganizerUploadSection eventId={id} />
          </TranslationsProvider>
        </div>
      </div>
    );
  }

  if (!event) return localizedRedirect(lang, '/dashboard/photographer/events');

  // Pending photos surface for both collaborative-with-approval AND
  // organizer-with-approval events. Those land in the dedicated "Pending"
  // tab queue. For everything else, `includePending: true` widens the main
  // grid to show owner uploads still being validated by the worker, so the
  // photographer sees their in-flight uploads instead of a phantom gap.
  const showPendingTab = eventUsesModerationQueue(event);

  // Round 1 — the first gallery page (only the first page is fetched + signed;
  // "Load more" fetches the rest via `loadMoreOwnerEventPhotos`), the small
  // un-paginated pending queue, the organizer photographers list, and the true
  // non-rejected total (for `RejectedToast`) are all independent.
  const [{ photos, hasMore }, pendingPhotos, eventPhotographers, visibleCount] = await Promise.all([
    getEventPhotosPage(adminClient, id, user.id, {
      skipUserIdFilter: true,
      includePending: !showPendingTab,
      limit: EVENT_GALLERY_PAGE_SIZE,
      offset: 0,
    }),
    showPendingTab
      ? getEventPhotos(adminClient, id, user.id, {
          status: 'pending',
          skipUserIdFilter: true,
          // The owner's own uploads auto-approve and must never sit in the
          // moderation queue — exclude them regardless of the worker's
          // transient state (race window or a worker that never promoted them).
          excludeOwnerUploads: true,
        })
      : Promise.resolve([]),
    event.type === 'organizer' ? getEventPhotographers(supabase, id) : Promise.resolve([]),
    countEventPhotos(adminClient, id),
  ]);

  // Round 2 — signing (approved + pending originals), talent tags, and uploader
  // profiles all depend only on the fetched photos, so run them together. Tags
  // are cookie-authenticated (RLS-friendly); profiles resolve `uploaded_by`
  // contributors (photographer's own uploads have no attribution row).
  const allPaths = [...photos, ...pendingPhotos]
    .map((p) => p.original_url)
    .filter((url): url is string => url !== null);
  const photoIds = photos.map((p) => p.id);
  const uploaderUserIds = Array.from(
    new Set(photos.map((p) => p.uploaded_by).filter((v): v is string => Boolean(v))),
  );
  const [signed, photoTags, uploaderProfiles] = await Promise.all([
    createPhotoUrlMap(adminClient, 'photos', allPaths, { expiresIn: 60 * 60 }),
    getPhotoTags(photoIds),
    getProfilesByIds(adminClient, uploaderUserIds),
  ]);

  const albumItems = photos
    .map((p) =>
      buildOwnerPhotoAlbumItem(p, {
        signed,
        uploaderProfiles,
        tags: photoTags,
        watermarkEnabled: event.watermark_enabled,
      }),
    )
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const pendingItems = pendingPhotos
    .map((p) => {
      const url = p.original_url ? signed[p.original_url] : null;
      if (!url) return null;
      return {
        id: p.id,
        url,
        uploaderLabel: p.guest_name ?? dict.collaborativeEvent.uploaderAuthenticated,
      };
    })
    .filter((item): item is { id: string; url: string; uploaderLabel: string } => item !== null);

  // AI matching status — only the owner sees the status surface. Contributors
  // see indexing happen silently. The columns are absent on older event rows
  // that pre-date the migration; cast through `unknown` so TS doesn't object.
  const eventRecord = event as unknown as Record<string, unknown>;
  const aiMatchingEnabled = Boolean(eventRecord.ai_matching_enabled);
  const bibDetectionEnabled = Boolean(eventRecord.bib_detection_enabled);
  const containsMinors = Boolean(eventRecord.contains_minors);
  const aiMatchingStatus =
    (eventRecord.ai_matching_status as AiMatchingStatus | undefined) ?? 'idle';
  const aiProgress =
    role === 'owner' && aiMatchingEnabled
      ? await getEventAiIndexingProgress(adminClient, id)
      : null;

  // Pull the upload-rejected toast copy from the existing newEvent
  // dictionary — shared with the wizard's "Upload rejected" messaging.
  // `visibleCount` (computed above) is the TRUE non-rejected total — everything
  // the worker approved or is still validating — not `albumItems.length` (now
  // just the first page), so `RejectedToast` diffs against the real count.
  const rejectedToastLabel = dict.newEvent.uploadRejectedToast;

  // The three sections above the gallery — "Event details", the live AI
  // indexing status and "Share event". AI and Share are conditional (`null`
  // when they don't apply); "Event details" is always present.
  const detailsCard = (
    <EventDetailsCard
      t={dict.eventDetails}
      type={event.type}
      isCollaborative={event.is_collaborative}
      activityLabel={
        dict.activities[event.activity as keyof typeof dict.activities] ?? event.activity
      }
      date={new Date(event.date).toDateString().split(' ').slice(1).join(' ')}
      location={formatEventLocation({
        city: event.city,
        state: event.state,
        country: event.country,
      })}
      pricePerPhoto={event.price_per_photo}
      isPublic={event.is_public}
      watermarkEnabled={event.watermark_enabled}
      aiMatchingEnabled={aiMatchingEnabled}
      bibDetectionEnabled={bibDetectionEnabled}
      containsMinors={containsMinors}
      requireUploadApproval={event.require_upload_approval}
      allowGuestUpload={event.allow_guest_upload}
      editHref={localizedPath(lang, `/dashboard/photographer/events/${id}/edit`)}
    />
  );

  const aiStatusCard =
    aiMatchingEnabled && aiProgress ? (
      <AiStatusCard
        eventId={id}
        status={aiMatchingStatus}
        totalApplicable={aiProgress.totalApplicable}
        indexed={aiProgress.indexed}
        pending={aiProgress.pending}
        failed={aiProgress.failed}
        lastIndexedAt={aiProgress.lastIndexedAt}
        labels={{
          title: dict.rekognition.cardTitle,
          statusIdle: dict.rekognition.statusIdle,
          statusIndexing: dict.rekognition.statusIndexing,
          statusReady: dict.rekognition.statusReady,
          statusFailed: dict.rekognition.statusFailed,
          indexedCount: dict.rekognition.statusIndexedCount,
          lastIndexed: dict.rekognition.lastIndexed,
          reindex: dict.rekognition.actionsReindex,
          reindexConfirmTitle: dict.rekognition.actionsReindexConfirmTitle,
          reindexConfirmBody: dict.rekognition.actionsReindexConfirmBody,
          cancel: dict.rekognition.cancel,
          confirm: dict.rekognition.confirm,
          reindexFailed: dict.rekognition.errorsAiEnableFailed,
          pollUpdating: dict.rekognition.pollUpdating,
          pollError: dict.rekognition.pollError,
          indexingComplete: dict.rekognition.indexingComplete,
          failedPhotosWarning: dict.rekognition.failedPhotosWarning,
          failedPhotosRetry: dict.rekognition.failedPhotosRetry,
        }}
      />
    ) : null;

  const shareCard = event.share_code ? (
    <EventShareCode
      shareCode={event.share_code}
      eventName={event.name}
      t={dict.shareEvent}
      label={event.is_collaborative ? dict.collaborativeEvent.shareLinkLabel : undefined}
    />
  ) : null;

  // 1, 2 or 3 cards depending on which sections apply — the grid column count
  // matches so the present cards share one equal-height row on desktop.
  const sectionCount = 1 + (aiStatusCard ? 1 : 0) + (shareCard ? 1 : 0);
  const sectionsGridClass =
    sectionCount === 3 ? 'md:grid-cols-3' : sectionCount === 2 ? 'md:grid-cols-2' : '';

  return (
    <div>
      {uploadedParam ? (
        <RejectedToast visibleCount={visibleCount} label={rejectedToastLabel} />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <DashboardHeader title={event.name} />
        <div className="shrink-0">
          <EventActionsMenu eventId={id} t={dict.events} />
        </div>
      </div>
      {/* Event details, live AI indexing status and "Share event" — one
          equal-height row on desktop (the grid stretches the cards to match),
          stacked full-width on mobile. AI and Share are conditional. */}
      <div className={cn('mt-4 grid gap-4', sectionsGridClass)}>
        {detailsCard}
        {aiStatusCard}
        {shareCard}
      </div>
      {event.type === 'organizer' && (
        <div className="mt-4">
          <TranslationsProvider translations={dict.organizerEvent}>
            <PhotographersSection eventId={id} initialPhotographers={eventPhotographers} />
          </TranslationsProvider>
        </div>
      )}
      <div className="mt-4">
        <TranslationsProvider translations={dict.events}>
          {showPendingTab ? (
            <EventModerationTabs
              approvedLabel={dict.collaborativeEvent.tabAllPhotos}
              pendingLabelTemplate={dict.collaborativeEvent.tabPending}
              approvedCount={visibleCount}
              pendingCount={pendingItems.length}
              albumProps={{
                eventId: id,
                isCollaborative: event.is_collaborative,
                uploaderLabels: {
                  tooltip: dict.collaborativeEvent.uploaderTooltip,
                  popoverHeading: dict.collaborativeEvent.uploaderPopoverHeading,
                  guestLabel: dict.collaborativeEvent.uploaderGuestLabel,
                  authenticatedLabel: dict.collaborativeEvent.uploaderAuthenticatedLabel,
                },
                iconTooltips: dict.photoIconButtons,
                items: albumItems,
                imageUnavailableLabel: dict.eventCard.imageUnavailable,
                totalCount: visibleCount,
                initialHasMore: hasMore,
                loadMoreLabel: dict.events.loadMore,
                loadMoreErrorLabel: dict.events.loadMoreFailed,
              }}
              pendingProps={{
                eventId: id,
                photos: pendingItems,
                labels: {
                  empty: dict.collaborativeEvent.pendingEmpty,
                  approveAria: dict.collaborativeEvent.approveAria,
                  rejectAria: dict.collaborativeEvent.rejectAria,
                  select: dict.collaborativeEvent.pendingSelect,
                  exitSelection: dict.collaborativeEvent.pendingExitSelection,
                  countOne: dict.collaborativeEvent.pendingCountOne,
                  countMany: dict.collaborativeEvent.pendingCountMany,
                  approveAll: dict.collaborativeEvent.pendingApproveAll,
                  approveSelected: dict.collaborativeEvent.pendingApproveSelected,
                  rejectSelected: dict.collaborativeEvent.pendingRejectSelected,
                  rejectConfirmTitle: dict.collaborativeEvent.rejectConfirmTitle,
                  rejectConfirmTitleMany: dict.collaborativeEvent.rejectConfirmTitleMany,
                  rejectConfirmDescription: dict.collaborativeEvent.rejectConfirmDescription,
                  rejectConfirmDescriptionMany:
                    dict.collaborativeEvent.rejectConfirmDescriptionMany,
                  rejectConfirmAction: dict.collaborativeEvent.rejectConfirmAction,
                  rejectConfirmCancel: dict.collaborativeEvent.rejectConfirmCancel,
                  rejectConfirmPending: dict.collaborativeEvent.rejectConfirmPending,
                  approveSuccessOne: dict.collaborativeEvent.approveSuccessOne,
                  approveSuccessMany: dict.collaborativeEvent.approveSuccessMany,
                  rejectSuccessOne: dict.collaborativeEvent.rejectSuccessOne,
                  rejectSuccessMany: dict.collaborativeEvent.rejectSuccessMany,
                  actionError: dict.collaborativeEvent.queueActionError,
                },
              }}
            />
          ) : (
            <EventPhotoAlbum
              eventId={id}
              isCollaborative={event.is_collaborative}
              uploaderLabels={{
                tooltip: dict.collaborativeEvent.uploaderTooltip,
                popoverHeading: dict.collaborativeEvent.uploaderPopoverHeading,
                guestLabel: dict.collaborativeEvent.uploaderGuestLabel,
                authenticatedLabel: dict.collaborativeEvent.uploaderAuthenticatedLabel,
              }}
              iconTooltips={dict.photoIconButtons}
              items={albumItems}
              imageUnavailableLabel={dict.eventCard.imageUnavailable}
              totalCount={visibleCount}
              initialHasMore={hasMore}
              loadMoreLabel={dict.events.loadMore}
              loadMoreErrorLabel={dict.events.loadMoreFailed}
            />
          )}
        </TranslationsProvider>
      </div>
    </div>
  );
}
