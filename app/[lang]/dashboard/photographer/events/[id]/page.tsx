import { DashboardHeader } from '@/components/dashboard-header';
import { EventShareCode } from '@/components/event-share-code';
import { createSignedUrls, getEvent, getEventPhotos } from '@/database/queries';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getPhotoTags } from './actions';
import { EventPhotoAlbum } from './event-photo-album';

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

  if (!user) return localizedRedirect(lang, '/login');

  const event = await getEvent(supabase, id, user.id);
  if (!event) return localizedRedirect(lang, '/dashboard/photographer/events');

  const photos = await getEventPhotos(supabase, id, user.id);

  // Generate signed URLs for private storage objects
  const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);
  const signed: Record<string, string> = {};

  if (paths.length > 0) {
    const signedUrls = await createSignedUrls(supabase, 'photos', paths, 60 * 60); // 1 hour
    for (const item of signedUrls) {
      if (item.signedUrl) {
        signed[item.path] = item.signedUrl;
      }
    }
  }

  // Get tags for all photos
  const photoIds = photos.map((p) => p.id);
  const photoTags = await getPhotoTags(photoIds);

  return (
    <div>
      <DashboardHeader title={event.name} />
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
      {!event.is_public && event.share_code && (
        <div className="mt-4">
          <EventShareCode shareCode={event.share_code} eventName={event.name} />
        </div>
      )}
      <div className="mt-4">
        <TranslationsProvider translations={dict.events}>
          <EventPhotoAlbum
            eventId={id}
            iconTooltips={dict.photoIconButtons}
            items={photos
              .map((p) => {
                const url = p.original_url ? signed[p.original_url] : null;
                if (!url) return null;
                return {
                  id: p.id,
                  url,
                  ...(p.original_url && { alt: p.original_url }),
                  tags: photoTags[p.id] || [],
                };
              })
              .filter(
                (
                  item,
                ): item is {
                  id: string;
                  url: string;
                  alt?: string;
                  tags: Array<{
                    tag_id: string;
                    talent_user_id: string;
                    talent_username: string;
                    talent_display_name: string | null;
                    tagged_at: string;
                  }>;
                } => item !== null,
              )}
          />
        </TranslationsProvider>
      </div>
    </div>
  );
}
