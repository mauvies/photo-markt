import { notFound } from 'next/navigation';
import { getActiveRole } from '@/app/[lang]/actions/roles';
import { AIMatchingButton } from '@/app/[lang]/dashboard/talent/photos/ai-matching/ai-matching-button';
import { DashboardHeader } from '@/components/dashboard-header';
import { createPhotoUrls, getEventPhotosPublic, isPhotoInCart } from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getBaseUrl } from '@/lib/get-base-url';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { EventPhotoViewer } from './event-photo-viewer';

export default async function ExploreEventDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();

  // Get event by ID - must be public (use admin to bypass RLS)
  const { data: event } = await supabaseAdmin
    .from('events')
    .select('*')
    .eq('id', id)
    .eq('is_public', true)
    .is('deleted_at', null)
    .single();

  if (!event) {
    notFound();
  }

  // Get photos for the event (use admin to bypass RLS)
  const photos = await getEventPhotosPublic(supabaseAdmin, event.id);

  // Get user info for watermark and cart check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check if user is talent (watermark only shows for talent users)
  let useWatermark = false;
  const photosInCart: string[] = [];
  const photosInMyPhotos: string[] = [];
  try {
    if (user) {
      const { activeRole } = await getActiveRole();
      // Only show watermark for talent users if watermark is enabled
      useWatermark = activeRole === 'talent';

      // Check which photos are in cart and in "my photos" (only for talent users)
      if (activeRole === 'talent') {
        const photoIds = photos.map((p) => p.id);
        for (const photoId of photoIds) {
          const inCart = await isPhotoInCart(supabase, user.id, photoId);
          if (inCart) {
            photosInCart.push(photoId);
          }
        }
        if (photoIds.length > 0) {
          const { data: tags } = await supabase
            .from('talent_photo_tags')
            .select('photo_id')
            .eq('talent_user_id', user.id)
            .in('photo_id', photoIds);
          for (const tag of tags ?? []) {
            photosInMyPhotos.push(tag.photo_id);
          }
        }
      }
    }
  } catch {
    // User not logged in or error - no watermark, no cart
    useWatermark = false;
  }

  // Generate URLs (watermarked or regular signed URLs)
  const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);
  const signed: Record<string, string> = {};

  if (paths.length > 0) {
    const baseUrl = await getBaseUrl();
    const photoUrls = await createPhotoUrls(supabaseAdmin, 'photos', paths, {
      expiresIn: 60 * 60, // 1 hour
      useWatermark,
      baseUrl,
    });
    for (const item of photoUrls) {
      if (item.signedUrl) {
        signed[item.path] = item.signedUrl;
      }
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

  return (
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

      {photoItems.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">{dict.talentDashboard.noPhotosAvailable}</p>
        </div>
      ) : (
        <div className="w-full space-y-3">
          <div className="flex justify-end">
            <AIMatchingButton className="h-9 rounded-full" />
          </div>
          <TranslationsProvider translations={dict.eventPhotoViewer}>
            <EventPhotoViewer
              items={photoItems}
              showAddToCart={user !== null}
              photosInCart={new Set(photosInCart)}
              photosInMyPhotos={new Set(photosInMyPhotos)}
              iconTooltips={dict.photoIconButtons}
            />
          </TranslationsProvider>
        </div>
      )}
    </div>
  );
}
