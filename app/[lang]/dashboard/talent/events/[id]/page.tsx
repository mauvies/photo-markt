import { CalendarClock } from 'lucide-react';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { getActiveRole } from '@/app/[lang]/actions/roles';
import { AIMatchingButton } from '@/app/[lang]/dashboard/talent/photos/ai-matching/ai-matching-button';
import { DashboardHeader } from '@/components/dashboard-header';
import { createPhotoUrls, getEventPhotosPublic, getPhotoIdsInCart } from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getEventStatus } from '@/lib/event-status';
import { getBaseUrl } from '@/lib/get-base-url';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { EventPhotoViewer } from './event-photo-viewer';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Caches the event-public slice of this page (event row + photos + signed URLs).
// User-specific bits (cart membership, photo tags) are computed AFTER this
// returns, so no per-user data crosses the cache boundary. `useWatermark`
// participates in the cache key — two cache entries per event (watermarked
// vs not), both deterministic for a given (param, baseUrl, useWatermark).
//
// Cache invalidated by photographer photo mutations via revalidateTag('event-<id>').
async function getCachedTalentEventData(param: string, baseUrl: string, useWatermark: boolean) {
  'use cache';
  cacheTag(`event-${param}`, 'events-public');
  // 55 min — safely under the 60-min signed URL expiry
  cacheLife({ revalidate: 55 * 60, expire: 55 * 60 });

  const { data: event } = await supabaseAdmin
    .from('events')
    .select('*')
    .eq(UUID_REGEX.test(param) ? 'id' : 'slug', param)
    .eq('is_public', true)
    .is('deleted_at', null)
    .single();

  if (!event) return null;

  const photos = await getEventPhotosPublic(supabaseAdmin, event.id);
  const signed: Record<string, string> = {};

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
  const useWatermark = activeRole === 'talent';

  const cached = await getCachedTalentEventData(param, baseUrl, useWatermark);
  if (!cached) notFound();
  const { event, photos, signed } = cached;

  const eventStatus = getEventStatus(event.date);

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
              imageUnavailableLabel={dict.eventCard.imageUnavailable}
            />
          </TranslationsProvider>
        </div>
      )}
    </div>
  );
}
