'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { addPhotoToCartAction } from '@/app/[lang]/dashboard/talent/cart/actions';
import { useGuestCart } from '@/components/guest-cart-provider';
import PhotoAlbumViewer from '@/components/photo-album-viewer';
import type { PhotoIconTooltips } from '@/components/photo-icon-buttons';
import type { GuestCartItem } from '@/lib/guest-cart';

interface PhotoItem {
  id: string;
  url: string;
  alt: string;
  originalPath: string | null;
}

interface PublicEventPhotoViewerProps {
  photos: PhotoItem[];
  eventId: string;
  eventName: string;
  eventDate: string;
  pricePerPhoto: number | null;
  photographerId: string;
  isAuthenticated: boolean;
  initialPhotosInCart: string[];
  iconTooltips?: Partial<PhotoIconTooltips>;
}

export function PublicEventPhotoViewer({
  photos,
  eventId,
  eventName,
  eventDate,
  pricePerPhoto,
  photographerId,
  isAuthenticated,
  initialPhotosInCart,
  iconTooltips,
}: PublicEventPhotoViewerProps) {
  const guestCart = useGuestCart();
  const [authCartPhotos, setAuthCartPhotos] = useState<Set<string>>(new Set(initialPhotosInCart));

  const photosInCart = useMemo(() => {
    if (isAuthenticated) return authCartPhotos;
    return new Set(photos.filter((p) => guestCart.hasItem(p.id)).map((p) => p.id));
  }, [isAuthenticated, authCartPhotos, photos, guestCart]);

  const handleAddToCart = useCallback(
    async (photoId: string) => {
      const photo = photos.find((p) => p.id === photoId);
      if (!photo) return;

      if (isAuthenticated) {
        try {
          await addPhotoToCartAction(photoId);
          setAuthCartPhotos((prev) => new Set([...prev, photoId]));
          toast.success('Added to cart', {
            action: {
              label: 'View cart',
              onClick: () => {
                window.location.href = '/dashboard/talent/cart';
              },
            },
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to add to cart');
        }
      } else {
        const item: GuestCartItem = {
          photoId,
          photographerId,
          eventId,
          eventName,
          eventDate,
          unitPriceCents: pricePerPhoto ? Math.round(pricePerPhoto * 100) : 0,
          previewUrl: photo.url,
        };
        guestCart.addItem(item);
        toast.success('Added to cart', {
          action: {
            label: 'View cart',
            onClick: () => {
              window.location.href = '/cart';
            },
          },
        });
      }
    },
    [
      isAuthenticated,
      photos,
      photographerId,
      eventId,
      eventName,
      eventDate,
      pricePerPhoto,
      guestCart,
    ],
  );

  const handleRemoveFromCart = useCallback(
    (photoId: string) => {
      if (isAuthenticated) {
        setAuthCartPhotos((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
      } else {
        guestCart.removeItem(photoId);
      }
    },
    [isAuthenticated, guestCart],
  );

  return (
    <div>
      {photos.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">No photos available yet.</p>
        </div>
      ) : (
        <PhotoAlbumViewer
          items={photos}
          showAddToCart={true}
          photosInCart={photosInCart}
          onAddToCart={handleAddToCart}
          onRemoveFromCart={handleRemoveFromCart}
          iconTooltips={iconTooltips}
        />
      )}
    </div>
  );
}
