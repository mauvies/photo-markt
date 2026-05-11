'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoIconTooltips } from '@/components/photo-icon-buttons';
import { useOptimisticPhotosInCart } from '@/hooks/use-optimistic-photos-in-cart';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { addPhotoToMyPhotosAction, removePhotoFromMyPhotosAction } from './actions';

type EventPhotoViewerProps = {
  items: PhotoAlbumItem[];
  showAddToCart?: boolean;
  photosInCart?: Set<string>;
  photosInMyPhotos?: Set<string>;
  iconTooltips?: Partial<PhotoIconTooltips>;
  imageUnavailableLabel: string;
};

export function EventPhotoViewer({
  items,
  showAddToCart = false,
  photosInCart: initialPhotosInCart = new Set(),
  photosInMyPhotos: initialPhotosInMyPhotos = new Set(),
  iconTooltips,
  imageUnavailableLabel,
}: EventPhotoViewerProps) {
  const { t } = useTranslations<{
    addedToPhotos: string;
    removedFromPhotos: string;
    addedToCart: string;
    removedFromCart: string;
    failedAddPhotos: string;
    failedRemovePhotos: string;
    failedAddCart: string;
    failedRemoveCart: string;
  }>();

  // Optimistic state for "my photos" — initialized from server prop, updates instantly on click
  const [myPhotos, setMyPhotos] = useState<Set<string>>(initialPhotosInMyPhotos);

  // Sync when server refreshes props (e.g. after router.refresh)
  useEffect(() => {
    setMyPhotos(initialPhotosInMyPhotos);
  }, [initialPhotosInMyPhotos]);

  // Optimistic cart state — the hook handles instant icon flip + badge sync.
  const { photosInCart, addToCart, removeFromCart } = useOptimisticPhotosInCart({
    initialPhotosInCart,
    addServerAction: addPhotoToCartAction,
    removeServerAction: removePhotoFromCartAction,
    toastLabels: { failedAdd: t('failedAddCart'), failedRemove: t('failedRemoveCart') },
  });

  // Success toasts fire alongside the optimistic flip (hook only emits on
  // failure). On a server error, the user sees this success briefly before
  // the error toast appears — acceptable given how rare cart errors are.
  const handleAddToCart = useCallback(
    (photoId: string) => {
      addToCart(photoId);
      toast.success(t('addedToCart'));
    },
    [addToCart, t],
  );

  const handleRemoveFromCart = useCallback(
    (photoId: string) => {
      removeFromCart(photoId);
      toast.success(t('removedFromCart'));
    },
    [removeFromCart, t],
  );

  const handleAddToPhotos = async (photoId: string) => {
    setMyPhotos((prev) => new Set([...prev, photoId]));
    try {
      await addPhotoToMyPhotosAction(photoId);
      toast.success(t('addedToPhotos'));
    } catch (error) {
      setMyPhotos((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
      toast.error(error instanceof Error ? error.message : t('failedAddPhotos'));
      throw error;
    }
  };

  const handleRemoveFromPhotos = async (photoId: string) => {
    setMyPhotos((prev) => {
      const next = new Set(prev);
      next.delete(photoId);
      return next;
    });
    try {
      await removePhotoFromMyPhotosAction(photoId);
      toast.success(t('removedFromPhotos'));
    } catch (error) {
      setMyPhotos((prev) => new Set([...prev, photoId]));
      toast.error(error instanceof Error ? error.message : t('failedRemovePhotos'));
      throw error;
    }
  };

  return (
    <PhotoAlbumViewer
      items={items}
      showAddToCart={showAddToCart}
      photosInCart={photosInCart}
      onAddToCart={handleAddToCart}
      onRemoveFromCart={handleRemoveFromCart}
      showAddToPhotos={true}
      photosInMyPhotos={myPhotos}
      onAddToPhotos={handleAddToPhotos}
      onRemoveFromPhotos={handleRemoveFromPhotos}
      iconTooltips={iconTooltips}
      imageUnavailableLabel={imageUnavailableLabel}
    />
  );
}
