'use client';

import { ArrowLeft, Download, Loader2, ShoppingCart, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import {
  addPhotoToMyPhotosAction,
  removePhotoFromMyPhotosAction,
} from '@/app/[lang]/dashboard/talent/events/[id]/actions';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useBibSearch, useFaceSearch } from '@/components/event-gallery-with-face-search';
import { EventPhotoCountLabel } from '@/components/event-photo-count-label';
import { type EventPhotoFilter, EventPhotoFilterTabs } from '@/components/event-photo-filter-tabs';
import { FaceSearchResults } from '@/components/face-search-results';
import { useGuestCart } from '@/components/guest-cart-provider';
import type { PhotoDetailModalLabels } from '@/components/photo-detail-modal';
import {
  type PhotoAlbumItem,
  PhotoGallery,
  type PhotoGalleryBulkAction,
  type PhotoGallerySection,
} from '@/components/photo-gallery';
import type { PhotoIconTooltips, PhotoMoreMenuConfig } from '@/components/photo-icon-buttons';
import type { BulkDownloadLabels } from '@/components/photo-selection-toolbar';
import { Button } from '@/components/ui/button';
import {
  type BulkContributorDeleteLabels,
  useBulkContributorDelete,
} from '@/hooks/use-bulk-contributor-delete';
import { useBulkPhotoDownload } from '@/hooks/use-bulk-photo-download';
import { useLoadMorePhotos } from '@/hooks/use-load-more-photos';
import { useOptimisticPhotosInCart } from '@/hooks/use-optimistic-photos-in-cart';
import { showAddedToCartToast } from '@/lib/cart-toast';
import { type EventBulkActionKey, eventBulkActionKeys } from '@/lib/event-bulk-actions';
import { filterEventPhotoPages, filterEventPhotos } from '@/lib/event-photo-filter';
import { resolveGalleryCounts } from '@/lib/gallery-photo-count';
import type { GuestCartItem } from '@/lib/guest-cart';
import { getEventPhotoDownloadUrlAction, loadMoreEventPhotos } from './actions';
import { buildBuckets, type FaceSearchResultsLabels } from './face-search-shared';
import { readGuestUploads, removeGuestUpload } from './guest-uploads-storage';
import type { PublicPhotoAlbumItem } from './photo-album-item';
import { useOptionalUploadProgress } from './upload-progress-provider';

// The public viewer needs the row-ownership fields (`userId`/`uploadedBy`) and
// the original path, so it renders the superset item shape end to end — the
// same shape the load-more action and enriched search results return.
type PhotoItem = PublicPhotoAlbumItem;

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
  /** Collaborative events get the "All photos / My photos" filter. */
  isCollaborative?: boolean;
  initialPhotosInCart: string[];
  /** Photo IDs the (authenticated) viewer has already favorited — seeds the
   * optimistic favorites state for the purchase modal (T-102). */
  initialPhotosInMyPhotos?: string[];
  /** Success/error toasts for the favorites toggle (auth-only). */
  favoriteToastLabels?: {
    added: string;
    removed: string;
    failedAdd: string;
    failedRemove: string;
  };
  iconTooltips?: Partial<PhotoIconTooltips>;
  /**
   * When false, the cart action is hidden on every photo. Used for free
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
  /** Labels for the bulk-delete flow (collaborative events). */
  bulkDeleteLabels: BulkContributorDeleteLabels;
  /** Translated error toasts for the cart icon. */
  cartToastLabels: { failedAdd: string; failedRemove: string };
  /** Labels for the "All photos / My photos" filter (collaborative events). */
  filterLabels: { all: string; mine: string; empty: string };
  /** Labels for the per-photo "more options" dropdown + lightbox actions. */
  menuLabels: {
    trigger: string;
    download: string;
    failed: string;
    notPurchased: string;
    addToCart: string;
    removeFromCart: string;
    /** "Uploaded by {name}" template. */
    uploadedBy: string;
  };
  /** Labels for the AI face-search results view. */
  resultsLabels: FaceSearchResultsLabels;
  /** Photo IDs the viewer has purchased — gates bulk download on paid events. */
  purchasedPhotoIds?: Set<string>;
  /** Localized copy for the selection toolbar + bulk download. */
  bulkDownload: BulkDownloadLabels;
  imageUnavailableLabel: string;
  /** True approved-photo total for the event (server-computed), shown in the
   * gallery toolbar count — reflects the whole event, not the loaded page (T-104). */
  totalCount: number;
  /** "Photos ({n})" template for the standalone count on non-collaborative
   * events (no tabs). */
  photosCountLabel: string;
  /** Empty-state copy when a bib search returns no matches (T-032). */
  bibSearchEmptyLabel?: string;
  /** Whether more photos exist beyond the first batch (drives "Load more"). */
  initialHasMore?: boolean;
  /** "Load more" button label. */
  loadMoreLabel: string;
  /** Toast shown when a "Load more" fetch fails. */
  loadMoreErrorLabel: string;
  /** Labels for the two-panel purchase detail modal (paid events). */
  photoDetailLabels: PhotoDetailModalLabels;
  /** Page locale (`lang`) for the purchase modal's date formatting. */
  locale: string;
  /** Event photographer's display name — the purchase modal's attribution
   * fallback for non-collaborative photos. */
  photographerName?: string;
}

export function PublicEventPhotoViewer({
  photos: photosProp,
  eventId,
  eventName,
  eventDate,
  pricePerPhoto,
  photographerId,
  isAuthenticated,
  currentUserId,
  shareCode,
  isCollaborative = false,
  initialPhotosInCart,
  initialPhotosInMyPhotos = [],
  favoriteToastLabels,
  iconTooltips,
  showAddToCart = true,
  emptyText,
  uploadingLabel,
  uploaderLabels,
  bulkDeleteLabels,
  cartToastLabels,
  filterLabels,
  menuLabels,
  resultsLabels,
  purchasedPhotoIds = new Set(),
  bulkDownload,
  imageUnavailableLabel,
  totalCount,
  photosCountLabel,
  bibSearchEmptyLabel,
  initialHasMore = false,
  loadMoreLabel,
  loadMoreErrorLabel,
  photoDetailLabels,
  locale,
  photographerName,
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
    // Pass the event's share code so a private event's photo is addable to the
    // authenticated cart (T-132) — a public event ignores it.
    addServerAction: (photoId) => addPhotoToCartAction(photoId, shareCode ?? undefined),
    removeServerAction: removePhotoFromCartAction,
    toastLabels: {
      failedAdd: cartToastLabels.failedAdd,
      failedRemove: cartToastLabels.failedRemove,
    },
  });
  // Bulk-delete dialog state. `deletedIds` filters the server-provided list so
  // deleted tiles drop instantly; router.refresh() then reconciles.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [skippedDeleteCount, setSkippedDeleteCount] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Paginated grid — the server sends the first batch; "Load more" appends the
  // next. Bound to the share code (or event id fallback), watermark following
  // the event's setting exactly like the cached first batch.
  const {
    items: gridPhotos,
    pages: gridPages,
    hasMore,
    isLoadingMore,
    loadMore,
  } = useLoadMorePhotos<PhotoItem>({
    initialItems: photosProp,
    initialHasMore,
    initialOffset: photosProp.length,
    fetchMore: (offset) => loadMoreEventPhotos(shareCode ?? eventId, offset),
    onError: () => toast.error(loadMoreErrorLabel),
  });
  const photos = useMemo(
    () => gridPhotos.filter((p) => !deletedIds.has(p.id)),
    [gridPhotos, deletedIds],
  );

  // Search state lives above cart/ownership so those resolve over the union of
  // the loaded grid AND the (complete, signed) search matches — a match beyond
  // page 1 must still support "Add to cart" and ownership checks.
  const faceSearch = useFaceSearch();
  const bibSearch = useBibSearch();

  // grid ∪ face-matched ∪ bib-matched, keyed by id (grid wins on collision).
  const displayablePhotos = useMemo(() => {
    const map = new Map<string, PhotoItem>();
    for (const p of photos) map.set(p.id, p);
    for (const p of faceSearch.matchedPhotos) if (!map.has(p.id)) map.set(p.id, p);
    for (const p of bibSearch.matchedPhotos) if (!map.has(p.id)) map.set(p.id, p);
    return map;
  }, [photos, faceSearch.matchedPhotos, bibSearch.matchedPhotos]);

  // Photo IDs the current browser owns (guest-upload tokens stored locally).
  const [guestOwnedPhotoIds, setGuestOwnedPhotoIds] = useState<Set<string>>(new Set());
  // Per-photo guest delete tokens, kept in sync with `guestOwnedPhotoIds` so a
  // bulk delete can pass each token without re-reading localStorage per id.
  const guestTokensRef = useRef<Map<string, string>>(new Map());

  // Hydrate guest-owned set from localStorage on mount and whenever the
  // photo list changes (e.g. after the contribute modal uploads new photos
  // and triggers a router.refresh()) — that way newly-uploaded items pick
  // up their delete tokens stored by the contribute flow in the same tick.
  useEffect(() => {
    if (!shareCode) {
      setGuestOwnedPhotoIds(new Set());
      guestTokensRef.current = new Map();
      return;
    }
    const stored = readGuestUploads(shareCode);
    setGuestOwnedPhotoIds(new Set(stored.map((s) => s.photoId)));
    guestTokensRef.current = new Map(
      stored
        .filter((s): s is typeof s & { deleteToken: string } => Boolean(s.deleteToken))
        .map((s) => [s.photoId, s.deleteToken]),
    );
  }, [shareCode]);

  // Photos the current viewer uploaded.
  // - Authenticated: match by user_id (set on every photo) or uploaded_by (set
  //   only on guest-uploaded photos, kept as fallback for edge cases).
  // - Guest (unauthenticated): match by localStorage token.
  // - Authenticated user who previously uploaded as guest: both checks apply,
  //   so photos from both identities are included (union).
  const myPhotoIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of displayablePhotos.values()) {
      if (currentUserId && (p.userId === currentUserId || p.uploadedBy === currentUserId)) {
        set.add(p.id);
      }
      if (shareCode && guestOwnedPhotoIds.has(p.id)) {
        set.add(p.id);
      }
    }
    return set;
  }, [displayablePhotos, currentUserId, shareCode, guestOwnedPhotoIds]);

  const photosInCart = useMemo(() => {
    if (isAuthenticated) return authCartPhotos;
    const set = new Set<string>();
    for (const p of displayablePhotos.values()) {
      if (guestCart.hasItem(p.id)) set.add(p.id);
    }
    return set;
  }, [isAuthenticated, authCartPhotos, displayablePhotos, guestCart]);

  // Where the "View cart" toast action navigates — the authenticated cart for
  // signed-in viewers, the guest cart route for everyone else.
  const cartHref = isAuthenticated ? '/dashboard/talent/cart' : '/cart';

  // Adds one photo to the active cart (optimistic auth cart or guest cart)
  // without any UI feedback. Returns false when the id isn't in the current
  // list. The toast is the caller's job, so a bulk add can emit one summary.
  const addPhotoToCart = useCallback(
    (photoId: string): boolean => {
      const photo = displayablePhotos.get(photoId);
      if (!photo) return false;
      if (isAuthenticated) {
        addAuthCart(photoId);
      } else {
        const item: GuestCartItem = {
          photoId,
          photographerId,
          eventId,
          eventName,
          eventDate,
          eventShareCode: shareCode ?? null,
          unitPriceCents: pricePerPhoto ? Math.round(pricePerPhoto * 100) : 0,
          previewUrl: photo.url,
        };
        guestCart.addItem(item);
      }
      return true;
    },
    [
      isAuthenticated,
      displayablePhotos,
      photographerId,
      eventId,
      eventName,
      eventDate,
      shareCode,
      pricePerPhoto,
      guestCart,
      addAuthCart,
    ],
  );

  const handleAddToCart = useCallback(
    (photoId: string) => {
      if (!addPhotoToCart(photoId)) return;
      showAddedToCartToast({
        message: bulkDownload.addedToCartOne,
        viewCartLabel: bulkDownload.viewCart,
        onViewCart: () => {
          window.location.href = cartHref;
        },
      });
    },
    [addPhotoToCart, cartHref, bulkDownload],
  );

  // Bulk "Add to cart" — adds every selected photo that isn't already in the
  // cart and isn't already purchased, then emits a single summary toast.
  const handleBulkAddToCart = useCallback(
    (ids: string[]) => {
      const toAdd = ids.filter((id) => !photosInCart.has(id) && !purchasedPhotoIds.has(id));
      if (toAdd.length === 0) {
        toast.info(bulkDownload.alreadyInCart);
        return;
      }
      let added = 0;
      for (const id of toAdd) {
        if (addPhotoToCart(id)) added += 1;
      }
      if (added === 0) return;
      showAddedToCartToast({
        message:
          added === 1
            ? bulkDownload.addedToCartOne
            : bulkDownload.addedToCartMany.replace('{n}', String(added)),
        viewCartLabel: bulkDownload.viewCart,
        onViewCart: () => {
          window.location.href = cartHref;
        },
      });
    },
    [photosInCart, purchasedPhotoIds, addPhotoToCart, bulkDownload, cartHref],
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

  // ── Favorites (auth-only) — optimistic, seeded from the server prop. Reuses
  // the talent "My Photos" server actions (T-102). Guests never see the button.
  const authFavInitial = useMemo(() => new Set(initialPhotosInMyPhotos), [initialPhotosInMyPhotos]);
  const [myPhotos, setMyPhotos] = useState<Set<string>>(authFavInitial);
  useEffect(() => {
    setMyPhotos(authFavInitial);
  }, [authFavInitial]);

  const handleAddToPhotos = useCallback(
    async (photoId: string) => {
      setMyPhotos((prev) => new Set([...prev, photoId]));
      try {
        await addPhotoToMyPhotosAction(photoId);
        if (favoriteToastLabels) toast.success(favoriteToastLabels.added);
      } catch (error) {
        setMyPhotos((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
        toast.error(
          error instanceof Error ? error.message : (favoriteToastLabels?.failedAdd ?? 'Error'),
        );
      }
    },
    [favoriteToastLabels],
  );

  const handleRemoveFromPhotos = useCallback(
    async (photoId: string) => {
      setMyPhotos((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
      try {
        await removePhotoFromMyPhotosAction(photoId);
        if (favoriteToastLabels) toast.success(favoriteToastLabels.removed);
      } catch (error) {
        setMyPhotos((prev) => new Set([...prev, photoId]));
        toast.error(
          error instanceof Error ? error.message : (favoriteToastLabels?.failedRemove ?? 'Error'),
        );
      }
    },
    [favoriteToastLabels],
  );

  // Optimistic removal after a bulk delete: drop the tiles, clean any guest
  // tokens for guest-owned deletions, then reconcile with the server.
  const handlePhotosDeleted = useCallback(
    (ids: string[]) => {
      setDeletedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      if (shareCode) {
        for (const id of ids) {
          if (guestOwnedPhotoIds.has(id)) removeGuestUpload(shareCode, id);
        }
        setGuestOwnedPhotoIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
      router.refresh();
    },
    [shareCode, guestOwnedPhotoIds, router],
  );

  const { isDeleting, deleteEligible, notifyNoneEligible } = useBulkContributorDelete({
    shareCode: shareCode ?? null,
    labels: bulkDeleteLabels,
    getDeleteToken: (id) => guestTokensRef.current.get(id),
    onDeleted: handlePhotosDeleted,
  });

  // Bulk delete is gated to photos the viewer uploaded (server re-checks).
  const handleBulkDeleteRequest = useCallback(
    (ids: string[]) => {
      const eligible = ids.filter((id) => myPhotoIds.has(id));
      if (eligible.length === 0) {
        notifyNoneEligible();
        return;
      }
      setPendingDeleteIds(eligible);
      setSkippedDeleteCount(ids.length - eligible.length);
      setDeleteDialogOpen(true);
    },
    [myPhotoIds, notifyNoneEligible],
  );

  const handleBulkDeleteConfirm = useCallback(
    () => deleteEligible(pendingDeleteIds, skippedDeleteCount),
    [deleteEligible, pendingDeleteIds, skippedDeleteCount],
  );

  const canDeleteOwnPhotos = isCollaborative && myPhotoIds.size > 0;

  // Free events download for anyone (incl. logged-out guests); paid events
  // need an authenticated buyer, so selection is disabled for paid-event guests.
  const isFreeEvent = pricePerPhoto === null;
  const isOwner = currentUserId != null && currentUserId === photographerId;
  const canBulkDownload = isFreeEvent || isAuthenticated;
  // Paid events expose a bulk "Add to cart" action — guests use the guest
  // cart, signed-in viewers the optimistic auth cart. Free events have no
  // cart. The Select button shows when either bulk action is reachable.
  const canBulkAddToCart = showAddToCart && !isFreeEvent;
  const canSelect = canBulkDownload || canBulkAddToCart || canDeleteOwnPhotos;
  const { isDownloading, downloadSelected } = useBulkPhotoDownload({
    eventId,
    isFreeEvent,
    purchasedPhotoIds,
    bulkDownload,
  });

  // ── AI face-search results ─────────────────────────────────────────────
  // Bucket the search's OWN signed matches (complete), not the paginated grid,
  // so a match beyond page 1 still renders.
  const bucketed = useMemo(
    () => buildBuckets<PhotoAlbumItem>(faceSearch.matches, faceSearch.matchedPhotos),
    [faceSearch.matches, faceSearch.matchedPhotos],
  );

  // ── "All photos / My photos" filter + bib search ────────────────────────
  const bibActive = bibSearch.matchedPhotoIds !== null;
  const [filter, setFilter] = useState<EventPhotoFilter>('all');

  // Grid mode: one filtered batch per load-more page, laid out as independent
  // segments (no reflow / scroll-jump on append). A bib search instead renders
  // its own complete, signed matched set.
  const gridBatches = useMemo(
    () => filterEventPhotoPages(gridPages, { deletedIds, filter, myPhotoIds }),
    [gridPages, deletedIds, filter, myPhotoIds],
  );
  const bibVisiblePhotos = useMemo(
    () => filterEventPhotos(bibSearch.matchedPhotos, { filter, myPhotoIds, bibMatchedIds: null }),
    [bibSearch.matchedPhotos, filter, myPhotoIds],
  );

  // The toolbar count reflects what's currently shown: during a bib search
  // that's the number of matches (per All/My tab), not the event total (T-122).
  const { all: displayedAllCount, mine: displayedMineCount } = useMemo(
    () =>
      resolveGalleryCounts({
        bibActive,
        matchedPhotos: bibSearch.matchedPhotos,
        mineIds: myPhotoIds,
        eventTotal: totalCount,
        mineTotal: myPhotoIds.size,
      }),
    [bibActive, bibSearch.matchedPhotos, myPhotoIds, totalCount],
  );

  // ── Single-photo download (lightbox) ───────────────────────────────────
  const isPhotoDownloadable = useCallback(
    (photoId: string) => isFreeEvent || isOwner || purchasedPhotoIds.has(photoId),
    [isFreeEvent, isOwner, purchasedPhotoIds],
  );

  const handleDownloadPhoto = useCallback(
    async (photoId: string) => {
      if (!isPhotoDownloadable(photoId)) {
        toast.error(menuLabels.notPurchased);
        return;
      }
      try {
        const url = await getEventPhotoDownloadUrlAction(photoId, eventId);
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.click();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : menuLabels.failed);
      }
    },
    [isPhotoDownloadable, eventId, menuLabels],
  );

  const handleCartToggle = useCallback(
    (photoId: string) => {
      if (photosInCart.has(photoId)) {
        handleRemoveFromCart(photoId);
      } else {
        handleAddToCart(photoId);
      }
    },
    [photosInCart, handleAddToCart, handleRemoveFromCart],
  );

  const moreMenu = useMemo<PhotoMoreMenuConfig>(
    () => ({
      labels: {
        trigger: menuLabels.trigger,
        download: menuLabels.download,
        addToCart: menuLabels.addToCart,
        removeFromCart: menuLabels.removeFromCart,
        uploadedBy: menuLabels.uploadedBy,
      },
      onDownload: handleDownloadPhoto,
      isDownloadDisabled: (id: string) => !isPhotoDownloadable(id),
      onCartToggle: handleCartToggle,
      showCartFor: (id: string) => !isFreeEvent && !purchasedPhotoIds.has(id),
      showUploaderRow: isCollaborative,
    }),
    [
      menuLabels,
      handleDownloadPhoto,
      isPhotoDownloadable,
      handleCartToggle,
      isFreeEvent,
      purchasedPhotoIds,
      isCollaborative,
    ],
  );

  // ── PhotoGallery config ────────────────────────────────────────────────
  const galleryProps = useMemo(
    () => ({
      showAddToCart,
      photosInCart,
      onAddToCart: handleAddToCart,
      onRemoveFromCart: handleRemoveFromCart,
      // Favorites is auth-only and scoped to the paid-event purchase modal —
      // guests never see it, and free events keep the lightbox (out of scope
      // for T-102, where favorites already live).
      showAddToPhotos: isAuthenticated && !isFreeEvent,
      photosInMyPhotos: myPhotos,
      onAddToPhotos: handleAddToPhotos,
      onRemoveFromPhotos: handleRemoveFromPhotos,
      iconTooltips,
      uploaderLabels,
      moreMenu: isCollaborative ? undefined : moreMenu,
      showUploaderName: isCollaborative,
      showDownload: canBulkDownload,
      isPhotoDownloadable,
      onDownload: handleDownloadPhoto,
      imageUnavailableLabel,
      lightboxActionBar: 'bottom' as const,
      actionBarLabels: {
        download: menuLabels.download,
        addToCart: menuLabels.addToCart,
        removeFromCart: menuLabels.removeFromCart,
        uploadedBy: menuLabels.uploadedBy,
      },
      // Paid events get the two-panel purchase modal; free events keep the
      // lightbox (bigger photo, no purchase moment).
      detailVariant: isFreeEvent ? ('lightbox' as const) : ('purchase' as const),
      pricePerPhoto,
      locale,
      photographerName,
      purchaseLabels: photoDetailLabels,
    }),
    [
      showAddToCart,
      photosInCart,
      handleAddToCart,
      handleRemoveFromCart,
      isAuthenticated,
      isFreeEvent,
      myPhotos,
      handleAddToPhotos,
      handleRemoveFromPhotos,
      iconTooltips,
      uploaderLabels,
      isCollaborative,
      moreMenu,
      canBulkDownload,
      isPhotoDownloadable,
      handleDownloadPhoto,
      imageUnavailableLabel,
      menuLabels,
      pricePerPhoto,
      locale,
      photographerName,
      photoDetailLabels,
    ],
  );

  // Bulk actions for the selection bars. "Add to cart" leads on a paid event
  // (the primary action for a buyer); "Download" only appears on free events —
  // paid events serve watermarked previews, so bulk-downloading them is useless
  // (T-010). The key list decides what shows; the map carries the handlers.
  const bulkActions = useMemo<PhotoGalleryBulkAction[]>(() => {
    const byKey: Record<EventBulkActionKey, PhotoGalleryBulkAction> = {
      'add-to-cart': {
        key: 'add-to-cart',
        label: bulkDownload.addToCart,
        icon: ShoppingCart,
        onRun: (ids) => handleBulkAddToCart(ids),
      },
      download: {
        key: 'download',
        label: bulkDownload.download,
        icon: Download,
        onRun: (ids) => downloadSelected(ids),
        isPending: isDownloading,
      },
      delete: {
        key: 'delete',
        label: bulkDeleteLabels.button,
        icon: Trash2,
        onRun: (ids) => handleBulkDeleteRequest(ids),
        isPending: isDeleting,
      },
    };
    return eventBulkActionKeys({
      canAddToCart: canBulkAddToCart,
      isFreeEvent,
      hasPurchasedPhotos: purchasedPhotoIds.size > 0,
      canDeleteOwnPhotos,
    }).map((key) => byKey[key]);
  }, [
    canBulkAddToCart,
    isFreeEvent,
    purchasedPhotoIds,
    canDeleteOwnPhotos,
    bulkDownload.addToCart,
    bulkDownload.download,
    bulkDeleteLabels.button,
    handleBulkAddToCart,
    downloadSelected,
    isDownloading,
    handleBulkDeleteRequest,
    isDeleting,
  ]);

  const selectionLabels = useMemo(
    () => ({
      select: bulkDownload.select,
      countNone: bulkDownload.countNone,
      countOne: bulkDownload.countOne,
      countMany: bulkDownload.countMany,
      exitSelection: bulkDownload.exitSelection,
    }),
    [bulkDownload],
  );

  const selectionResetKey = `${filter}:${faceSearch.matches === null ? 'all' : 'search'}`;

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
      ) : faceSearch.matches !== null ? (
        <FaceSearchResults
          bucketed={bucketed}
          matchCount={faceSearch.matches.length}
          eventIndexingComplete={faceSearch.eventIndexingComplete}
          resultsLabels={resultsLabels}
          onTryAgain={faceSearch.openSearch}
          onViewAll={faceSearch.clearMatches}
          renderGallery={(sections: PhotoGallerySection[]) => (
            <PhotoGallery
              sections={sections}
              galleryProps={galleryProps}
              bulkActions={bulkActions}
              selectable={canSelect}
              labels={selectionLabels}
              selectionResetKey={selectionResetKey}
              toolbarClassName="sticky top-[var(--header-height)]"
              gridClassName="-mx-3.5 sm:mx-0"
              toolbarLeading={
                <Button type="button" variant="outline" size="sm" onClick={faceSearch.clearMatches}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  {resultsLabels.viewAllPhotos}
                </Button>
              }
            />
          )}
        />
      ) : (
        <PhotoGallery
          items={bibActive ? bibVisiblePhotos : undefined}
          itemBatches={bibActive ? undefined : gridBatches}
          galleryProps={galleryProps}
          bulkActions={bulkActions}
          selectable={canSelect}
          labels={selectionLabels}
          selectionResetKey={selectionResetKey}
          toolbarClassName=" sticky top-[var(--header-height)]"
          gridClassName=""
          loadMore={
            bibActive
              ? undefined
              : { hasMore, isLoading: isLoadingMore, onLoadMore: loadMore, label: loadMoreLabel }
          }
          toolbarLeading={
            isCollaborative ? (
              <EventPhotoFilterTabs
                value={filter}
                onValueChange={setFilter}
                allLabel={filterLabels.all}
                mineLabel={filterLabels.mine}
                allCount={displayedAllCount}
                mineCount={displayedMineCount}
              />
            ) : displayedAllCount > 0 ? (
              <EventPhotoCountLabel
                label={photosCountLabel.replace('{n}', String(displayedAllCount))}
              />
            ) : undefined
          }
          emptyState={
            <div className="py-12 text-center">
              <p className="text-muted-foreground">
                {bibSearch.matchedPhotoIds !== null
                  ? (bibSearchEmptyLabel ?? filterLabels.empty)
                  : filterLabels.empty}
              </p>
            </div>
          }
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
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteDialogOpen(false);
        }}
        title={bulkDeleteLabels.confirmTitle}
        description={bulkDeleteLabels.confirmDesc
          .replace('{n}', String(pendingDeleteIds.length))
          .replace(
            '{noun}',
            pendingDeleteIds.length === 1
              ? bulkDeleteLabels.photoNoun
              : bulkDeleteLabels.photosNoun,
          )}
        confirmText={bulkDeleteLabels.confirmButton}
        cancelText={bulkDeleteLabels.cancelButton}
        pendingText={bulkDeleteLabels.deletingLabel}
        onConfirm={handleBulkDeleteConfirm}
      />
    </div>
  );
}
