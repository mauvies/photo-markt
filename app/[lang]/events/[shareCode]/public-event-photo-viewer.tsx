'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useGuestCart } from '@/components/guest-cart-provider';
import PhotoAlbumViewer from '@/components/photo-album-viewer';
import type { PhotoIconTooltips } from '@/components/photo-icon-buttons';
import type { PhotoUploaderInfo } from '@/components/photo-uploader-indicator';
import { useOptimisticPhotosInCart } from '@/hooks/use-optimistic-photos-in-cart';
import type { GuestCartItem } from '@/lib/guest-cart';
import { deleteContributorPhotoAction } from './actions';
import { readGuestUploads, removeGuestUpload } from './guest-uploads-storage';
import { useOptionalUploadProgress } from './upload-progress-provider';

interface PhotoItem {
  id: string;
  url: string;
  alt: string;
  originalPath: string | null;
  uploadedBy?: string | null;
  uploader?: PhotoUploaderInfo;
}

interface PublicEventPhotoViewerProps {
  photos: PhotoItem[];
  eventId: string;
  eventName: string;
  eventDate: string;
  pricePerPhoto: number | null;
  photographerId: string;
  isAuthenticated: boolean;
  /** auth.uid() of the current viewer, when signed in. */
  currentUserId?: string | null;
  /** Event share code, used to scope guest-uploads localStorage. */
  shareCode?: string | null;
  initialPhotosInCart: string[];
  iconTooltips?: Partial<PhotoIconTooltips>;
  /**
   * When false, the cart icon is hidden on every photo. Used for free
   * collaborative events where photos aren't for sale.
   */
  showAddToCart?: boolean;
  /** Localized copy shown when there are no photos yet. */
  emptyText?: string;
  /** Localized copy shown over the gallery while an upload is in flight. */
  uploadingLabel?: string;
  /** Labels for the contributor badge popover. */
  uploaderLabels?: {
    tooltip: string;
    popoverHeading: string;
    guestLabel: string;
    authenticatedLabel: string;
  };
  /** Labels for the per-photo delete affordance. */
  deleteLabels?: {
    tooltip: string;
    confirmTitle: string;
    confirmDesc: string;
    confirmButton: string;
    cancelButton: string;
    successToast: string;
    failedToast: string;
  };
  /** Translated error toasts for the cart icon. */
  cartToastLabels: { failedAdd: string; failedRemove: string };
  imageUnavailableLabel: string;
}

export function PublicEventPhotoViewer({
  photos,
  eventId,
  eventName,
  eventDate,
  pricePerPhoto,
  photographerId,
  isAuthenticated,
  currentUserId,
  shareCode,
  initialPhotosInCart,
  iconTooltips,
  showAddToCart = true,
  emptyText,
  uploadingLabel,
  uploaderLabels,
  deleteLabels,
  cartToastLabels,
  imageUnavailableLabel,
}: PublicEventPhotoViewerProps) {
  const router = useRouter();
  const guestCart = useGuestCart();
  const uploadProgress = useOptionalUploadProgress();
  const isUploading = uploadProgress?.isUploading ?? false;
  const uploadingCount = uploadProgress?.uploadingCount ?? 0;
  // Auth cart — managed via the shared optimistic hook so the icon flips
  // instantly. Seeded from the server prop on mount.
  const authInitialSet = useMemo(() => new Set(initialPhotosInCart), [initialPhotosInCart]);
  const {
    photosInCart: authCartPhotos,
    addToCart: addAuthCart,
    removeFromCart: removeAuthCart,
  } = useOptimisticPhotosInCart({
    initialPhotosInCart: authInitialSet,
    addServerAction: addPhotoToCartAction,
    removeServerAction: removePhotoFromCartAction,
    toastLabels: {
      failedAdd: cartToastLabels.failedAdd,
      failedRemove: cartToastLabels.failedRemove,
    },
  });
  const [pendingDeletePhotoId, setPendingDeletePhotoId] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  // Photo IDs the current browser owns (guest-upload tokens stored locally).
  const [guestOwnedPhotoIds, setGuestOwnedPhotoIds] = useState<Set<string>>(new Set());

  // Hydrate guest-owned set from localStorage on mount and whenever the
  // photo list changes (e.g. after the contribute modal uploads new photos
  // and triggers a router.refresh()) — that way newly-uploaded items pick
  // up their delete tokens stored by the contribute flow in the same tick.
  useEffect(() => {
    if (!shareCode) {
      setGuestOwnedPhotoIds(new Set());
      return;
    }
    const stored = readGuestUploads(shareCode);
    setGuestOwnedPhotoIds(new Set(stored.map((s) => s.photoId)));
  }, [shareCode]);

  const deletableIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of photos) {
      if (currentUserId && p.uploadedBy === currentUserId) {
        set.add(p.id);
      } else if (!isAuthenticated && shareCode && guestOwnedPhotoIds.has(p.id)) {
        set.add(p.id);
      }
    }
    return set;
  }, [photos, currentUserId, isAuthenticated, shareCode, guestOwnedPhotoIds]);

  const photosInCart = useMemo(() => {
    if (isAuthenticated) return authCartPhotos;
    return new Set(photos.filter((p) => guestCart.hasItem(p.id)).map((p) => p.id));
  }, [isAuthenticated, authCartPhotos, photos, guestCart]);

  const handleAddToCart = useCallback(
    (photoId: string) => {
      const photo = photos.find((p) => p.id === photoId);
      if (!photo) return;

      if (isAuthenticated) {
        // Hook flips the icon optimistically + bumps the cart-count cache.
        // The success toast (with "View cart" action) is rendered alongside
        // so the user still gets a clear confirmation + jump-to-cart entry.
        addAuthCart(photoId);
        toast.success('Added to cart', {
          action: {
            label: 'View cart',
            onClick: () => {
              window.location.href = '/dashboard/talent/cart';
            },
          },
        });
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
      addAuthCart,
    ],
  );

  const handleRemoveFromCart = useCallback(
    (photoId: string) => {
      if (isAuthenticated) {
        removeAuthCart(photoId);
      } else {
        guestCart.removeItem(photoId);
      }
    },
    [isAuthenticated, removeAuthCart, guestCart],
  );

  const handleDeleteRequest = useCallback((photoId: string) => {
    setPendingDeletePhotoId(photoId);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    const photoId = pendingDeletePhotoId;
    if (!photoId || !shareCode) return;
    // Look up the guest delete token, if any. Authenticated contributors
    // (including the event owner) leave this undefined and authorize via
    // their session.
    const stored = readGuestUploads(shareCode);
    const token = stored.find((s) => s.photoId === photoId)?.deleteToken ?? undefined;

    startDeleting(async () => {
      try {
        await deleteContributorPhotoAction({
          photoId,
          shareCode,
          deleteToken: token ?? undefined,
        });
        removeGuestUpload(shareCode, photoId);
        setGuestOwnedPhotoIds((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
        setPendingDeletePhotoId(null);
        toast.success(deleteLabels?.successToast ?? 'Photo deleted');
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : (deleteLabels?.failedToast ?? 'Could not delete the photo.'),
        );
        setPendingDeletePhotoId(null);
      }
    });
  }, [pendingDeletePhotoId, shareCode, deleteLabels, router]);

  return (
    <div className="relative">
      {photos.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">
            {isUploading
              ? (uploadingLabel ?? 'Uploading…').replace('{n}', String(uploadingCount))
              : (emptyText ?? 'No photos available yet.')}
          </p>
        </div>
      ) : (
        <PhotoAlbumViewer
          items={photos}
          showAddToCart={showAddToCart}
          photosInCart={photosInCart}
          onAddToCart={handleAddToCart}
          onRemoveFromCart={handleRemoveFromCart}
          iconTooltips={iconTooltips}
          deletableIds={deletableIds}
          onDeleteOwn={handleDeleteRequest}
          deleteTooltip={deleteLabels?.tooltip}
          uploaderLabels={uploaderLabels}
          imageUnavailableLabel={imageUnavailableLabel}
        />
      )}
      {isUploading && photos.length > 0 ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-start justify-center pt-8"
          aria-live="polite"
        >
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-input bg-background/95 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>{(uploadingLabel ?? 'Uploading…').replace('{n}', String(uploadingCount))}</span>
          </div>
        </div>
      ) : null}
      {deleteLabels ? (
        <ConfirmDialog
          open={pendingDeletePhotoId !== null}
          onOpenChange={(open) => {
            if (!open && !isDeleting) setPendingDeletePhotoId(null);
          }}
          title={deleteLabels.confirmTitle}
          description={deleteLabels.confirmDesc}
          confirmText={deleteLabels.confirmButton}
          cancelText={deleteLabels.cancelButton}
          onConfirm={handleDeleteConfirm}
        />
      ) : null}
    </div>
  );
}
