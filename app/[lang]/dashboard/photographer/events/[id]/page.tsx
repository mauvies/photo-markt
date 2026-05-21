import { DashboardHeader } from '@/components/dashboard-header';
import { EventShareCode } from '@/components/event-share-code';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createSignedUrls,
  getEvent,
  getEventPhotographers,
  getEventPhotos,
  isApprovedEventPhotographer,
  type SupabaseServerClient,
} from '@/database/queries';
import { type AiMatchingStatus, getEventAiIndexingProgress } from '@/database/queries/rekognition';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getPhotoTags } from './actions';
import { AiStatusCard } from './ai-status-card';
import { EventActionsMenu } from './event-actions-menu';
import { EventDetailsCard } from './event-details-card';
import { EventPhotoAlbum } from './event-photo-album';
import { OrganizerUploadSection } from './organizer-upload-section';
import { PendingPhotosTab } from './pending-photos-tab';
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
        <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {new Date(event.date).toDateString().split(' ').slice(1).join(' ')} •{' '}
          {event.city[0]?.toUpperCase() + event.city.slice(1)}
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
  const showPendingTab =
    (event.is_collaborative || event.type === 'organizer') && event.require_upload_approval;

  const photos = showPendingTab
    ? await getEventPhotos(adminClient, id, user.id, { skipUserIdFilter: true })
    : await getEventPhotos(adminClient, id, user.id, {
        skipUserIdFilter: true,
        includePending: true,
      });

  const pendingPhotos = showPendingTab
    ? await getEventPhotos(adminClient, id, user.id, {
        status: 'pending',
        skipUserIdFilter: true,
      })
    : [];

  // Organizer-event photographers list (membership). Empty array for other types.
  const eventPhotographers =
    event.type === 'organizer' ? await getEventPhotographers(supabase, id) : [];

  // Generate signed URLs for private storage objects (approved + pending).
  const allPaths = [...photos, ...pendingPhotos]
    .map((p) => p.original_url)
    .filter((url): url is string => url !== null);
  const signed: Record<string, string> = {};

  if (allPaths.length > 0) {
    const signedUrls = await createSignedUrls(adminClient, 'photos', allPaths, 60 * 60); // 1 hour
    for (const item of signedUrls) {
      if (item.signedUrl) {
        signed[item.path] = item.signedUrl;
      }
    }
  }

  // Get tags for all approved photos (cookie-authenticated, RLS-friendly).
  const photoIds = photos.map((p) => p.id);
  const photoTags = await getPhotoTags(photoIds);

  // Resolve uploader display names. Photos with a populated `uploaded_by`
  // (authed contributor) get their profile's display_name/username; photos
  // with `guest_name` (unauthed contributor) use that directly. The
  // photographer's own uploads have neither set and don't get a badge.
  const uploaderUserIds = Array.from(
    new Set(photos.map((p) => p.uploaded_by).filter((v): v is string => Boolean(v))),
  );
  const uploaderProfiles: Record<string, { display_name: string | null; username: string }> = {};
  if (uploaderUserIds.length > 0) {
    const { data: profilesData } = await adminClient
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

  type UploaderInfo = {
    name: string;
    email?: string | null;
    isAuthenticated: boolean;
  };

  const buildUploader = (p: (typeof photos)[number]): UploaderInfo | undefined => {
    if (p.uploaded_by) {
      const profile = uploaderProfiles[p.uploaded_by];
      const name = profile?.display_name ?? profile?.username ?? p.guest_name ?? '';
      if (!name) return undefined;
      return { name, isAuthenticated: true };
    }
    if (p.guest_name) {
      return {
        name: p.guest_name,
        email: p.guest_email ?? null,
        isAuthenticated: false,
      };
    }
    return undefined;
  };

  const albumItems = photos
    .map((p) => {
      const url = p.original_url ? signed[p.original_url] : null;
      if (!url) return null;
      return {
        id: p.id,
        url,
        ...(p.original_url && { alt: p.original_url }),
        tags: photoTags[p.id] || [],
        uploader: buildUploader(p),
      };
    })
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
  const containsMinors = Boolean(eventRecord.contains_minors);
  const aiMatchingStatus =
    (eventRecord.ai_matching_status as AiMatchingStatus | undefined) ?? 'idle';
  const aiProgress =
    role === 'owner' && aiMatchingEnabled
      ? await getEventAiIndexingProgress(adminClient, id)
      : null;

  // Pull the upload-rejected toast copy from the existing newEvent
  // dictionary — shared with the wizard's "Upload rejected" messaging.
  const rejectedToastLabel = dict.newEvent.uploadRejectedToast;
  // For the count-mismatch check, "visible" means anything the worker has
  // either approved or is still mid-validation. Rejected rows are filtered
  // out by the queries above.
  const visibleCount = albumItems.length;

  // Live AI indexing status — rendered inside the "Event details" card's
  // always-visible area. Owner-only; absent when AI matching is off.
  const aiStatus =
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
    ) : undefined;

  // "Event details" — built once, placed in either the two-column grid (with
  // a "Share event" card) or full-width when the event has no share code.
  const detailsCard = (
    <EventDetailsCard
      t={dict.eventDetails}
      type={event.type}
      isCollaborative={event.is_collaborative}
      activityLabel={
        dict.activities[event.activity as keyof typeof dict.activities] ?? event.activity
      }
      date={new Date(event.date).toDateString().split(' ').slice(1).join(' ')}
      location={[event.city[0]?.toUpperCase() + event.city.slice(1), event.country]
        .filter(Boolean)
        .join(', ')}
      pricePerPhoto={event.price_per_photo}
      isPublic={event.is_public}
      watermarkEnabled={event.watermark_enabled}
      aiMatchingEnabled={aiMatchingEnabled}
      containsMinors={containsMinors}
      requireUploadApproval={event.require_upload_approval}
      allowGuestUpload={event.allow_guest_upload}
      aiStatus={aiStatus}
    />
  );

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
      {/* "Event details" (with the live AI indexing status inside its
          always-visible area) and "Share event". Side by side on desktop —
          details 2/3, share 1/3 — stacked on mobile. Details spans the full
          width when the event has no share code. */}
      {event.share_code ? (
        <div className="mt-4 grid items-start gap-4 md:grid-cols-3">
          <div className="md:col-span-2">{detailsCard}</div>
          <div className="md:col-span-1">
            <EventShareCode
              shareCode={event.share_code}
              eventName={event.name}
              t={dict.shareEvent}
              label={event.is_collaborative ? dict.collaborativeEvent.shareLinkLabel : undefined}
            />
          </div>
        </div>
      ) : (
        <div className="mt-4">{detailsCard}</div>
      )}
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
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">{dict.collaborativeEvent.tabAllPhotos}</TabsTrigger>
                <TabsTrigger value="pending">
                  {dict.collaborativeEvent.tabPending.replace('{n}', String(pendingItems.length))}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="mt-4">
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
                />
              </TabsContent>
              <TabsContent value="pending" className="mt-4">
                <PendingPhotosTab
                  eventId={id}
                  photos={pendingItems}
                  labels={{
                    empty: dict.collaborativeEvent.pendingEmpty,
                    approveAria: dict.collaborativeEvent.approveAria,
                    rejectAria: dict.collaborativeEvent.rejectAria,
                    rejectConfirm: dict.collaborativeEvent.rejectConfirm,
                  }}
                />
              </TabsContent>
            </Tabs>
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
            />
          )}
        </TranslationsProvider>
      </div>
    </div>
  );
}
