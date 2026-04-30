'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoIconTooltips } from '@/components/photo-icon-buttons';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { addPhotoToMyPhotosAction, removePhotoFromMyPhotosAction } from './actions';

type EventPhotoViewerProps = {
  items: PhotoAlbumItem[];
  showAddToCart?: boolean;
  photosInCart?: Set<string>;
  photosInMyPhotos?: Set<string>;
  iconTooltips?: Partial<PhotoIconTooltips>;
};

export function EventPhotoViewer({
  items,
  showAddToCart = false,
  photosInCart = new Set(),
  photosInMyPhotos: initialPhotosInMyPhotos = new Set(),
  iconTooltips,
}: EventPhotoViewerProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
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

  const handleAddToCart = async (photoId: string) => {
    try {
      await addPhotoToCartAction(photoId);
      toast.success(t('addedToCart'));
      queryClient.invalidateQueries({ queryKey: ['cart-count'] });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('failedAddCart'));
      throw error;
    }
  };

  const handleRemoveFromCart = async (photoId: string) => {
    try {
      await removePhotoFromCartAction(photoId);
      toast.success(t('removedFromCart'));
      queryClient.invalidateQueries({ queryKey: ['cart-count'] });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('failedRemoveCart'));
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
    />
  );
}
