import { DashboardHeader } from '@/components/dashboard-header';
import { EventShareCode } from '@/components/event-share-code';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createSignedUrls,
  getEvent,
  getEventPhotos,
  type SupabaseServerClient,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getPhotoTags } from './actions';
import { EventActionsMenu } from './event-actions-menu';
import { EventPhotoAlbum } from './event-photo-album';
import { PendingPhotosTab } from './pending-photos-tab';

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return redirectToLogin();

  const event = await getEvent(supabase, id, user.id);
  if (!event) return localizedRedirect(lang, '/dashboard/photographer/events');

  // Ownership is verified above. Switch to the service-role client for
  // photo SELECT and storage URL signing so guest-contributed photos under
  // `collaborative/{event_id}/...` aren't filtered out by storage RLS
  // (which only allows reading `{auth.uid()}/...`).
  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

  const photos = await getEventPhotos(adminClient, id, user.id, { skipUserIdFilter: true });

  // Pending photos only matter when collaborative + approval is required.
  const showPendingTab = event.is_collaborative && event.require_upload_approval;
  const pendingPhotos = showPendingTab
    ? await getEventPhotos(adminClient, id, user.id, {
        status: 'pending',
        skipUserIdFilter: true,
      })
    : [];

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

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <DashboardHeader title={event.name} />
        <div className="shrink-0">
          <EventActionsMenu eventId={id} t={dict.events} />
        </div>
      </div>
      <div className="text-sm text-muted-foreground">
        {new Date(event.date).toDateString().split(' ').slice(1).join(' ')} •{' '}
        {event.city[0]?.toUpperCase() + event.city.slice(1)}
        {event.price_per_photo !== null && (
          <>
            {' '}
            • ${event.price_per_photo.toFixed(2)} {dict.photographerDashboard.perPhoto}
          </>
        )}
      </div>
      {event.share_code && (
        <div className="mt-4">
          <EventShareCode
            shareCode={event.share_code}
            eventName={event.name}
            label={event.is_collaborative ? dict.collaborativeEvent.shareLinkLabel : undefined}
          />
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
                  iconTooltips={dict.photoIconButtons}
                  items={albumItems}
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
            <EventPhotoAlbum eventId={id} iconTooltips={dict.photoIconButtons} items={albumItems} />
          )}
        </TranslationsProvider>
      </div>
    </div>
  );
}
