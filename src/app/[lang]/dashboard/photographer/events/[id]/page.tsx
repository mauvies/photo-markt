import { Images, ScanFace } from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard-header';
import { EventMetaLine } from '@/components/event-meta-line';
import { PhotosEmptyState } from '@/components/photos-empty-state';
import { Badge } from '@/components/ui/badge';
import {
  countEventPhotos,
  countEventPhotosByStatus,
  createPhotoUrlMap,
  getEvent,
  getEventPhotographers,
  getEventPhotos,
  getEventPhotosPage,
  getProfilesByIds,
  isApprovedEventPhotographer,
  type SupabaseServerClient,
} from '@/database/queries';
import {
  type BibDetectionEventStatus,
  getEventBibDetectionProgress,
} from '@/database/queries/bib-numbers';
import { type AiMatchingStatus, getEventAiIndexingProgress } from '@/database/queries/rekognition';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';
import { parseBundleTiers } from '@/lib/bundle-pricing';
import { EVENT_GALLERY_PAGE_SIZE } from '@/lib/event-gallery';
import { eventUsesModerationQueue } from '@/lib/event-status';
import { formatEventLocation } from '@/lib/format-location';
import { getBaseUrl } from '@/lib/get-base-url';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getShareableEventPath } from '@/lib/shareable-event-url';
import { getPhotoTags } from './actions';
import { AiStatusCard } from './ai-status-card';
import { BibStatusCard } from './bib-status-card';
import { EventActionsMenu } from './event-actions-menu';
import { EventInfoCard } from './event-info-card';
import { EventModerationTabs } from './event-moderation-tabs';
import { EventPhotoAlbum } from './event-photo-album';
import { EventPricingTab } from './event-pricing-tab';
import { EventSettingsCard } from './event-settings-card';
import { EventShareTab } from './event-share-tab';
import { parseEventTab } from './event-tab';
import { EventTabs } from './event-tabs';
import { OrganizerUploadSection } from './organizer-upload-section';
import { buildOwnerPhotoAlbumItem } from './owner-album-item';
import { PhotographersSection } from './photographers-section';
import { PhotosProcessingNotice } from './photos-processing-notice';
import { RejectedToast } from './rejected-toast';

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ uploaded?: string; tab?: string | string[] }>;
}) {
  const { lang, id } = await params;
  // `uploaded` is the count of photos the client attached in the previous
  // wizard/edit submit. If the worker later rejects any of those (invalid
  // bytes, size-mismatch), the rendered grid will show fewer than `uploaded`
  // — `RejectedToast` does the diff and fires a single toast.
  // `tab` selects the active top-level tab (Photos/Details/Share, T-178).
  const { uploaded: uploadedParam, tab: tabParam } = await searchParams;
  const initialTab = parseEventTab(tabParam);
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
  const [{ photos, hasMore }, pendingPhotos, eventPhotographers, visibleCount, approvedCount] =
    await Promise.all([
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
      // Approved-only total — only the tab-less (solo) view needs it, to spell
      // out how many of `visibleCount` are actually public vs still processing
      // (T-174). Moderation events already break this out via the Pending tab.
      showPendingTab ? Promise.resolve(0) : countEventPhotosByStatus(adminClient, id, ['approved']),
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
  const bibDetectionStatus =
    (eventRecord.bib_detection_status as BibDetectionEventStatus | undefined) ?? 'idle';
  const [aiProgress, bibProgress] = await Promise.all([
    role === 'owner' && aiMatchingEnabled
      ? getEventAiIndexingProgress(adminClient, id)
      : Promise.resolve(null),
    role === 'owner' && bibDetectionEnabled
      ? getEventBibDetectionProgress(adminClient, id)
      : Promise.resolve(null),
  ]);

  // Pull the upload-rejected toast copy from the existing newEvent
  // dictionary — shared with the wizard's "Upload rejected" messaging.
  // `visibleCount` (computed above) is the TRUE non-rejected total — everything
  // the worker approved or is still validating — not `albumItems.length` (now
  // just the first page), so `RejectedToast` diffs against the real count.
  const rejectedToastLabel = dict.newEvent.uploadRejectedToast;

  // The Details tab splits the event configuration into two cards (T-179):
  // "Event info" (date/location/activity/type/price/visibility) and "Event
  // settings" (the on/off toggles). Each has its own Edit button that opens a
  // scoped edit page (`?section=info` / `?section=settings`) so editing is
  // localized rather than opening the whole-event form.
  const infoCard = (
    <EventInfoCard
      t={dict.eventDetails}
      type={event.type}
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
      editHref={localizedPath(lang, `/dashboard/photographer/events/${id}/edit?section=info`)}
    />
  );
  const settingsCard = (
    <EventSettingsCard
      t={dict.eventDetails}
      isCollaborative={event.is_collaborative}
      watermarkEnabled={event.watermark_enabled}
      aiMatchingEnabled={aiMatchingEnabled}
      bibDetectionEnabled={bibDetectionEnabled}
      containsMinors={containsMinors}
      requireUploadApproval={event.require_upload_approval}
      allowGuestUpload={event.allow_guest_upload}
      editHref={localizedPath(lang, `/dashboard/photographer/events/${id}/edit?section=settings`)}
    />
  );

  const aiStatusCard =
    aiMatchingEnabled && aiProgress ? (
      <AiStatusCard
        eventId={id}
        status={aiMatchingStatus}
        totalApplicable={aiProgress.totalApplicable}
        totalPhotos={aiProgress.totalPhotos}
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
          noticeNoPhotos: dict.rekognition.noticeNoPhotos,
          noticeNoneApplicable: dict.rekognition.noticeNoneApplicable,
        }}
      />
    ) : null;

  const bibStatusCard =
    bibDetectionEnabled && bibProgress ? (
      <BibStatusCard
        eventId={id}
        status={bibDetectionStatus}
        totalApplicable={bibProgress.totalApplicable}
        processed={bibProgress.processed}
        pending={bibProgress.pending}
        failed={bibProgress.failed}
        withBibs={bibProgress.withBibs}
        labels={{
          cardTitle: dict.bibStatus.cardTitle,
          statusIdle: dict.bibStatus.statusIdle,
          statusDetecting: dict.bibStatus.statusDetecting,
          statusReady: dict.bibStatus.statusReady,
          statusFailed: dict.bibStatus.statusFailed,
          processedCount: dict.bibStatus.processedCount,
          withBibs: dict.bibStatus.withBibs,
          pollUpdating: dict.bibStatus.pollUpdating,
          pollError: dict.bibStatus.pollError,
          detectionComplete: dict.bibStatus.detectionComplete,
          failedPhotosWarning: dict.bibStatus.failedPhotosWarning,
        }}
      />
    ) : null;

  // Pricing tab (T-203, D17): read-only ladder + a link to the scoped pricing
  // editor, mirroring how the Details cards link to `?section=info`/`settings`.
  const pricingTab = (
    <EventPricingTab
      t={dict.bundlePricing}
      editLabel={dict.eventDetails.edit}
      freeLabel={dict.eventDetails.free}
      pricePerPhoto={event.price_per_photo}
      bundleTiers={parseBundleTiers(eventRecord.bundle_tiers)}
      bundleAllPhotosCents={
        (eventRecord.bundle_all_photos_cents as number | null | undefined) ?? null
      }
      isOrganizerEvent={event.type === 'organizer'}
      editHref={localizedPath(lang, `/dashboard/photographer/events/${id}/edit?section=pricing`)}
    />
  );

  // The event's real shareable URL, resolved to the public route that actually
  // grants access (public → slug/id, private → share code, T-179) and prefixed
  // with the current locale. `getBaseUrl` uses the request host so the copied
  // link opens in the same environment (dev/preview/prod).
  const shareUrl = `${await getBaseUrl()}${getShareableEventPath(event, lang)}`;
  const shareTab = (
    <EventShareTab
      eventName={event.name}
      shareUrl={shareUrl}
      isPublic={event.is_public}
      labels={{
        heading: dict.events.shareTabHeading,
        description: dict.events.shareTabDescription,
        privateNote: dict.events.shareTabPrivateNote,
        copy: dict.events.shareTabCopy,
        copied: dict.events.shareTabCopied,
        shareTooltip: dict.events.shareTabShare,
      }}
    />
  );

  // Compact indexing indicator for the persistent header — a summarised view of
  // the AI face-matching status; the full `AiStatusCard` (with polling/actions)
  // stays in the Details tab. Shown only when AI matching is on and past idle.
  // The feature label ("AI face matching") is prefixed onto the bare status
  // word so "Ready" isn't contextless — it reads "AI face matching: Ready".
  const indexingStatusLabel =
    aiMatchingStatus === 'ready'
      ? dict.rekognition.statusReady
      : aiMatchingStatus === 'indexing'
        ? dict.rekognition.statusIndexing
        : dict.rekognition.statusFailed;
  const indexingBadge =
    aiMatchingEnabled && aiProgress && aiMatchingStatus !== 'idle' ? (
      <Badge
        variant={aiMatchingStatus === 'failed' ? 'destructive' : 'secondary'}
        className="gap-1 font-normal"
      >
        <ScanFace className="h-3 w-3" />
        {dict.rekognition.cardTitle}: {indexingStatusLabel}
      </Badge>
    ) : null;

  // Tab slots — the existing sections, regrouped. Photos: the processing notice
  // + moderation/album grid (behaviour identical). Details: the info + status
  // cards + organizer photographers. Share: the shareable-URL card (T-179).
  // Empty Photos tab (T-208) — a brand-new event used to render a blank panel.
  // The CTA points at the owner's own upload path (the full `/edit` form), never
  // at the contributor upload flow: this branch is owner-only, and on
  // collaborative/organizer events contributors upload from their own screen.
  const photosEmptyState = (
    <PhotosEmptyState
      icon={Images}
      title={dict.events.photosEmptyTitle}
      description={dict.events.photosEmptyDescription}
      action={{
        href: localizedPath(lang, `/dashboard/photographer/events/${id}/edit`),
        label: dict.events.photosEmptyCta,
      }}
    />
  );

  const photosTab = (
    <TranslationsProvider translations={dict.events}>
      {!showPendingTab ? (
        <PhotosProcessingNotice
          pendingCount={visibleCount - approvedCount}
          approvedCount={approvedCount}
          labels={{
            processingOne: dict.events.photosProcessingOne,
            processingMany: dict.events.photosProcessingMany,
          }}
        />
      ) : null}
      <div>
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
              emptyState: photosEmptyState,
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
                emptyDescription: dict.collaborativeEvent.pendingEmptyDescription,
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
                rejectConfirmDescriptionMany: dict.collaborativeEvent.rejectConfirmDescriptionMany,
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
            emptyState={photosEmptyState}
            totalCount={visibleCount}
            initialHasMore={hasMore}
            loadMoreLabel={dict.events.loadMore}
            loadMoreErrorLabel={dict.events.loadMoreFailed}
          />
        )}
      </div>
    </TranslationsProvider>
  );

  // Details tab layout: the full-width "Event details" card (its own internal
  // field grid) on top, then the live AI/bib status cards side by side below,
  // then the organizer photographers section.
  const detailsTab = (
    <div className="space-y-4">
      {infoCard}
      {settingsCard}
      {aiStatusCard || bibStatusCard ? (
        <div className="grid gap-4 md:grid-cols-2">
          {aiStatusCard}
          {bibStatusCard}
        </div>
      ) : null}
      {event.type === 'organizer' && (
        <TranslationsProvider translations={dict.organizerEvent}>
          <PhotographersSection eventId={id} initialPhotographers={eventPhotographers} />
        </TranslationsProvider>
      )}
    </div>
  );

  return (
    <div>
      {uploadedParam ? (
        <RejectedToast visibleCount={visibleCount} label={rejectedToastLabel} />
      ) : null}
      {/* Persistent event header — visible on every tab so the photographer
          always knows which event they're in without opening Details.
          `md:pr-14` reserves the top-right space the layout's floating account
          avatar (`absolute top-4 right-4`, desktop-only) occupies, so the event
          actions menu (⋮) doesn't sit underneath it. On mobile the avatar isn't
          rendered (bottom nav instead), so no reservation is needed there. */}
      <div className="flex items-start justify-between gap-3 md:pr-14">
        <div className="min-w-0">
          <DashboardHeader title={event.name} />
          {/* Event details under the title — same shared meta line the talent
              event view uses, so the two never diverge in field order/format. */}
          <EventMetaLine
            className="mt-1"
            date={event.date}
            sessionTime={event.session_time}
            sessionEndTime={event.session_end_time}
            city={event.city}
            state={event.state}
            country={event.country}
            locale={lang}
            perPhotoLabel={dict.events.perPhoto}
            pricePerPhoto={event.price_per_photo}
          />
          {indexingBadge ? <div className="mt-1.5">{indexingBadge}</div> : null}
        </div>
        <div className="shrink-0">
          <EventActionsMenu eventId={id} t={dict.events} />
        </div>
      </div>
      <EventTabs
        initialTab={initialTab}
        labels={{
          photos: dict.events.tabPhotos,
          details: dict.events.tabDetails,
          pricing: dict.bundlePricing.tabTitle,
          share: dict.events.tabShare,
        }}
        photos={photosTab}
        details={detailsTab}
        pricing={pricingTab}
        share={shareTab}
      />
    </div>
  );
}
