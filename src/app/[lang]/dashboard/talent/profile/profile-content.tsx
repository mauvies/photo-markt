'use client';

import { Camera } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import type { ProfileData } from './actions';
import { ProfilePhotoViewer } from './profile-photo-viewer';

type ProfileContentProps = {
  initialData: ProfileData;
  showSuccessMessage?: boolean;
  translations: Record<string, string>;
};

export function ProfileContent({
  initialData,
  showSuccessMessage = false,
  translations,
}: ProfileContentProps) {
  const { profile, stats, photos } = initialData;
  const router = useRouter();
  const lp = useLocalizedPath();
  // Stable primitive (lang doesn't change within a render tree) — safe to use
  // as an effect dependency without re-running on every render.
  const profilePath = lp('/dashboard/talent/profile');

  useEffect(() => {
    if (!showSuccessMessage) return;
    toast.success(translations.purchaseSuccess, { duration: 5000 });
    // Re-fetch server data after a delay to allow the Stripe webhook to process, then clean URL
    const timer = setTimeout(() => {
      router.refresh();
      router.replace(profilePath, { scroll: false });
    }, 3000);
    return () => clearTimeout(timer);
  }, [showSuccessMessage, router, translations.purchaseSuccess, profilePath]);

  const displayName = profile?.display_name || profile?.username || 'User';

  const photoItems = useMemo(() => {
    return photos
      .map((photo) => ({
        id: photo.photo_id,
        url: photo.preview_url ?? '',
        alt: photo.event_name ? `Photo from ${photo.event_name}` : 'Purchased photo',
      }))
      .filter((item) => item.url);
  }, [photos]);

  const photoMetadata = useMemo(() => {
    const metadata: Record<
      string,
      {
        download_url: string | null;
        event_name: string | null;
        event_date: string | null;
        photographer_display_name: string | null;
        photographer_username: string | null;
      }
    > = {};
    photos.forEach((photo) => {
      metadata[photo.photo_id] = {
        download_url: photo.download_url,
        event_name: photo.event_name,
        event_date: photo.event_date,
        photographer_display_name: photo.photographer_display_name,
        photographer_username: photo.photographer_username,
      };
    });
    return metadata;
  }, [photos]);

  return (
    <>
      {/* Profile Header */}
      {/* Mobile: avatar left + username inline; Desktop: Instagram-style with stats */}
      <div className="sm:pb-5 mb-6 sm:mb-0">
        {/* Mobile layout */}
        {/* <div className="flex items-center gap-4 sm:hidden mb-6">
          <Avatar className="h-16 w-16 shrink-0 border-2 border-border">
            <AvatarImage src={profile?.avatar_url ?? undefined} alt={displayName} />
            <AvatarFallback className="text-2xl font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <h1 className="text-xl font-light">{displayName}</h1>
        </div> */}
        {/* Desktop layout */}
        <div className="flex gap-6">
          <div className="flex justify-start">
            <Avatar className="h-26 w-26 shrink-0 border-2 border-border">
              <AvatarImage src={profile?.avatar_url ?? undefined} alt={displayName} />
              <AvatarFallback className="text-2xl sm:text-4xl font-semibold">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-4 mb-4">
              <h1 className="text-3xl font-light">{displayName}</h1>
            </div>
            <div className="flex gap-8 mb-4">
              <div>
                <span className="block text-xl font-semibold">{stats.purchasedPhotosCount}</span>
                <span className="text-sm text-muted-foreground">{translations.statsPhotos}</span>
              </div>
              <div>
                <span className="block text-xl font-semibold">{stats.eventsCount}</span>
                <span className="text-sm text-muted-foreground">{translations.statsEvents}</span>
              </div>
              <div>
                <span className="block text-xl font-semibold">{stats.purchasesCount}</span>
                <span className="text-sm text-muted-foreground">{translations.statsPurchases}</span>
              </div>
            </div>
          </div>
        </div>
        {profile?.bio && <p className="text-base mt-4">{profile.bio}</p>}
      </div>

      {/* Photo Grid. Gated on `photoItems` (the renderable set) rather than raw
          `photos`, so owned rows without a usable preview URL still fall through
          to the empty state instead of painting a blank grid. */}
      {photoItems.length === 0 ? (
        // Empty state — mirrors the cart's empty state (icon + title +
        // description + actions) so a talent with no purchases isn't met with a
        // near-blank page.
        <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
          <div className="mb-6 rounded-full bg-muted p-6">
            <Camera className="h-10 w-10 text-muted-foreground/60" />
          </div>
          <h3 className="mb-2 text-2xl font-semibold">{translations.emptyTitle}</h3>
          <p className="mb-6 max-w-md text-sm text-muted-foreground">
            {translations.emptyDescription}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={lp('/dashboard/talent/events')}>
              <Button>{translations.exploreEvents}</Button>
            </Link>
            <Link href={lp('/dashboard/talent/favorites')}>
              <Button variant="outline">{translations.viewFavorites}</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="w-full pt-2 sm:pt-4">
          <TranslationsProvider translations={translations}>
            <ProfilePhotoViewer items={photoItems} photoMetadata={photoMetadata} />
          </TranslationsProvider>
        </div>
      )}
    </>
  );
}
