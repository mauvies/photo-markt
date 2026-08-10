'use client';

import { ArrowLeft, Download, Heart, ShoppingCart, Trash2, UserRoundPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import {
  getEventPhotoDownloadUrlAction,
  loadMoreEventPhotos,
} from '@/app/[lang]/events/[shareCode]/actions';
import {
  buildBuckets,
  type FaceSearchResultsLabels,
} from '@/app/[lang]/events/[shareCode]/face-search-shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  type EventBundleLabels,
  useBundleSelectionNote,
} from '@/components/event-bundle-selection';
import { useBibSearch, useFaceSearch } from '@/components/event-gallery-with-face-search';
import { EventPhotoCountLabel } from '@/components/event-photo-count-label';
import { type EventPhotoFilter, EventPhotoFilterTabs } from '@/components/event-photo-filter-tabs';
import { FaceSearchResults } from '@/components/face-search-results';
import { GatedSearchPanel, type GatedSearchPanelLabels } from '@/components/gated-search-panel';
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
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { useOptimisticPhotosInCart } from '@/hooks/use-optimistic-photos-in-cart';
import { filterNewIds } from '@/lib/bulk-select';
import type { BundleTier } from '@/lib/bundle-pricing';
import { showAddedToCartToast } from '@/lib/cart-toast';
import { shouldShowBulkDownload } from '@/lib/event-bulk-actions';
import {
  bibSearchEmptyKind,
  filterEventPhotoPages,
  filterEventPhotos,
} from '@/lib/event-photo-filter';
import { resolveEventGalleryView } from '@/lib/find-my-photos';
import { resolveGalleryCounts } from '@/lib/gallery-photo-count';
import { useTranslations } from '@/lib/i18n/translations-provider';
import {
  addPhotosToMyPhotosAction,
  addPhotosToProfileAction,
  addPhotoToMyPhotosAction,
  addPhotoToProfileAction,
  removePhotoFromMyPhotosAction,
} from './actions';

/** Localized copy for the per-photo "more options" dropdown. */
export type PhotoMenuLabels = {
  trigger: string;
  download: string;
  addToFavorites: string;
  removeFromFavorites: string;
  addToProfile: string;
  addedToProfile: string;
  addToCart: string;
  removeFromCart: string;
  /** "Uploaded by {name}" template. */
  uploadedBy: string;
  downloadFailed: string;
  downloadNotPurchased: string;
};

type EventPhotoViewerProps = {
  items: PhotoAlbumItem[];
  eventId: string;
  /** Free events let anyone download; paid events restrict to purchased photos. */
  isFreeEvent: boolean;
  /** Collaborative events get the "All photos / My photos" filter + uploader row. */
  isCollaborative?: boolean;
  /** Event share code — required to delete the talent's own collaborative uploads. */
  shareCode?: string | null;
  /** Photo IDs the current talent uploaded — backs the "My photos" filter and
   * gates bulk delete (talents may only delete their own uploads). */
  uploadedPhotoIds?: Set<string>;
  /** Labels for the bulk-delete flow (collaborative events). */
  bulkDeleteLabels: BulkContributorDeleteLabels;
  /** Labels for the "All photos / My photos" filter (collaborative events). */
  filterLabels: { all: string; mine: string; empty: string };
  /** Reveal-gated pre-search panel (T-230) — the mirror of the public viewer's
   *  prop. Present only on a gated event; when nothing is revealed yet it owns
   *  the whole gallery slot, explanation and search CTA included. */
  gatedPanel?: { labels: GatedSearchPanelLabels; photoCount?: number | null };
  /** Whether the event has any detected bib numbers yet — drives the bib
   * search empty state ("still processing" vs "no match"). */
  bibHasData?: boolean;
  /** Empty-state copy for a bib search that returned nothing (T-069). */
  bibEmptyLabels?: { pending: string; noMatch: string };
  /** Labels for the per-photo "more options" dropdown. */
  menuLabels: PhotoMenuLabels;
  /** Labels for the AI face-search results view. */
  resultsLabels: FaceSearchResultsLabels;
  purchasedPhotoIds?: Set<string>;
  bulkDownload: BulkDownloadLabels;
  showAddToCart?: boolean;
  photosInCart?: Set<string>;
  /** Photo IDs in the talent's Favorites (talent_photo_tags). */
  photosInMyPhotos?: Set<string>;
  /** Photo IDs the talent has claimed into their profile (talent_claimed_photos). */
  photosClaimedToProfile?: Set<string>;
  iconTooltips?: Partial<PhotoIconTooltips>;
  imageUnavailableLabel: string;
  /** True approved-photo total for the event (server-computed) — the toolbar
   * count reflects the whole event, not the loaded page (T-104). */
  totalCount: number;
  /** "Photos ({n})" template for the standalone count on non-collaborative
   * events (no tabs). */
  photosCountLabel: string;
  /** Whether more photos exist beyond the first batch (drives "Load more"). */
  initialHasMore?: boolean;
  /** "Load more" button label. */
  loadMoreLabel: string;
  /** Toast shown when a "Load more" fetch fails. */
  loadMoreErrorLabel: string;
  /** Flat event price in dollars — shown in the paid-event purchase modal. */
  pricePerPhoto?: number | null;
  /** Volume-pricing ladder for this event (T-204); null = no ladder. */
  bundleTiers?: BundleTier[] | null;
  /** The event's "all photos" flat price in cents, if set (T-204). */
  bundleAllPhotosCents?: number | null;
  /** Copy for every bundle affordance in this viewer (T-204). */
  bundleLabels?: EventBundleLabels;
  /** Labels for the two-panel purchase detail modal (paid events). */
  photoDetailLabels: PhotoDetailModalLabels;
  /** Page locale (`lang`) for the purchase modal's date formatting. */
  locale: string;
  /** Event photographer's display name — the purchase modal's attribution
   * fallback for non-collaborative photos. */
  photographerName?: string;
};

export function EventPhotoViewer({
  items: itemsProp,
  eventId,
  isFreeEvent,
  isCollaborative = false,
  shareCode = null,
  uploadedPhotoIds = new Set(),
  bulkDeleteLabels,
  filterLabels,
  gatedPanel,
  bibHasData = false,
  bibEmptyLabels,
  menuLabels,
  resultsLabels,
  purchasedPhotoIds = new Set(),
  bulkDownload,
  showAddToCart = false,
  photosInCart: initialPhotosInCart = new Set(),
  photosInMyPhotos: initialPhotosInMyPhotos = new Set(),
  photosClaimedToProfile: initialClaimedPhotos = new Set(),
  iconTooltips,
  imageUnavailableLabel,
  totalCount,
  photosCountLabel,
  initialHasMore = false,
  loadMoreLabel,
  loadMoreErrorLabel,
  pricePerPhoto,
  bundleTiers,
  bundleAllPhotosCents,
  bundleLabels,
  photoDetailLabels,
  locale,
  photographerName,
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
    photoAddedToProfile: string;
    failedAddProfile: string;
    bulkFavorited: string;
    bulkFavoritedOne: string;
    alreadyInFavorites: string;
    bulkClaimed: string;
    bulkClaimedSkipped: string;
    failedBulkFavorite: string;
    failedBulkClaim: string;
  }>();
  const router = useRouter();
  const lp = useLocalizedPath();

  // Bulk-delete dialog state. `deletedIds` filters the server-provided list so
  // deleted tiles drop instantly; router.refresh() then reconciles.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [skippedDeleteCount, setSkippedDeleteCount] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Paginated grid — server sends the first batch, "Load more" appends the rest.
  const {
    pages: gridPages,
    hasMore,
    isLoadingMore,
    loadMore,
  } = useLoadMorePhotos<PhotoAlbumItem>({
    initialItems: itemsProp,
    initialHasMore,
    initialOffset: itemsProp.length,
    fetchMore: (offset) => loadMoreEventPhotos(shareCode ?? eventId, offset),
    onError: () => toast.error(loadMoreErrorLabel),
  });

  // Favorites — optimistic, seeded from the server prop.
  const [myPhotos, setMyPhotos] = useState<Set<string>>(initialPhotosInMyPhotos);
  useEffect(() => {
    setMyPhotos(initialPhotosInMyPhotos);
  }, [initialPhotosInMyPhotos]);

  // Claimed-to-profile — optimistic, seeded from the server prop. Add-only.
  const [claimedPhotos, setClaimedPhotos] = useState<Set<string>>(initialClaimedPhotos);
  useEffect(() => {
    setClaimedPhotos(initialClaimedPhotos);
  }, [initialClaimedPhotos]);

  // Optimistic cart state — the hook handles instant icon flip + badge sync.
  const { photosInCart, addToCart, removeFromCart } = useOptimisticPhotosInCart({
    initialPhotosInCart,
    // Pass the event's share code so a private event's photo is addable to the
    // authenticated cart (T-132) — a public event ignores it.
    addServerAction: (photoId) => addPhotoToCartAction(photoId, shareCode ?? undefined),
    removeServerAction: removePhotoFromCartAction,
    toastLabels: { failedAdd: t('failedAddCart'), failedRemove: t('failedRemoveCart') },
  });

  const handleAddToCart = useCallback(
    (photoId: string) => {
      addToCart(photoId);
      showAddedToCartToast({
        message: t('addedToCart'),
        viewCartLabel: bulkDownload.viewCart,
        onViewCart: () => router.push(lp('/dashboard/talent/cart')),
      });
    },
    [addToCart, t, bulkDownload, router, lp],
  );

  const handleRemoveFromCart = useCallback(
    (photoId: string) => {
      removeFromCart(photoId);
      toast.success(t('removedFromCart'));
    },
    [removeFromCart, t],
  );

  const handleAddToPhotos = useCallback(
    async (photoId: string) => {
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
    },
    [t],
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
        toast.success(t('removedFromPhotos'));
      } catch (error) {
        setMyPhotos((prev) => new Set([...prev, photoId]));
        toast.error(error instanceof Error ? error.message : t('failedRemovePhotos'));
        throw error;
      }
    },
    [t],
  );

  const handleFavoriteToggle = useCallback(
    (photoId: string) => {
      if (myPhotos.has(photoId)) {
        void handleRemoveFromPhotos(photoId).catch(() => {});
      } else {
        void handleAddToPhotos(photoId).catch(() => {});
      }
    },
    [myPhotos, handleAddToPhotos, handleRemoveFromPhotos],
  );

  // Claim a free photo into the profile (owned collection). Add-only.
  const handleClaimToProfile = useCallback(
    async (photoId: string) => {
      if (claimedPhotos.has(photoId)) return;
      setClaimedPhotos((prev) => new Set([...prev, photoId]));
      try {
        await addPhotoToProfileAction(photoId);
        toast.success(t('photoAddedToProfile'));
      } catch (error) {
        setClaimedPhotos((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
        toast.error(error instanceof Error ? error.message : t('failedAddProfile'));
      }
    },
    [claimedPhotos, t],
  );

  // ── Bulk download / favorite / claim ───────────────────────────────────
  const { isDownloading, downloadSelected } = useBulkPhotoDownload({
    eventId,
    isFreeEvent,
    purchasedPhotoIds,
    bulkDownload,
  });
  const [isBulkFavoriting, setIsBulkFavoriting] = useState(false);
  const [isBulkClaiming, setIsBulkClaiming] = useState(false);

  const handleBulkFavorite = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || isBulkFavoriting) return;
      // Only act on photos that aren't already favorited — otherwise the toast
      // reports the whole selection every time and we re-hit the server for
      // no-ops (mirrors handleBulkAddToCart). (T-042)
      const toAdd = filterNewIds(ids, myPhotos);
      if (toAdd.length === 0) {
        toast.info(t('alreadyInFavorites'));
        return;
      }
      setIsBulkFavoriting(true);
      try {
        await addPhotosToMyPhotosAction(toAdd);
        setMyPhotos((prev) => new Set([...prev, ...toAdd]));
        toast.success(
          toAdd.length === 1
            ? t('bulkFavoritedOne')
            : t('bulkFavorited').replace('{n}', String(toAdd.length)),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('failedBulkFavorite'));
      } finally {
        setIsBulkFavoriting(false);
      }
    },
    [isBulkFavoriting, myPhotos, t],
  );

  const handleBulkClaim = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || isBulkClaiming) return;
      setIsBulkClaiming(true);
      try {
        const { claimed, skipped } = await addPhotosToProfileAction(ids);
        setClaimedPhotos((prev) => new Set([...prev, ...ids]));
        toast.success(
          skipped > 0
            ? t('bulkClaimedSkipped')
                .replace('{n}', String(claimed))
                .replace('{m}', String(skipped))
            : t('bulkClaimed').replace('{n}', String(claimed)),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('failedBulkClaim'));
      } finally {
        setIsBulkClaiming(false);
      }
    },
    [isBulkClaiming, t],
  );

  // Bulk "Add to cart" — adds every selected photo not already in the cart and
  // not already purchased, then emits a single summary toast.
  const handleBulkAddToCart = useCallback(
    (ids: string[]) => {
      const toAdd = filterNewIds(ids, photosInCart, purchasedPhotoIds);
      if (toAdd.length === 0) {
        toast.info(bulkDownload.alreadyInCart);
        return;
      }
      for (const id of toAdd) addToCart(id);
      showAddedToCartToast({
        message:
          toAdd.length === 1
            ? bulkDownload.addedToCartOne
            : bulkDownload.addedToCartMany.replace('{n}', String(toAdd.length)),
        viewCartLabel: bulkDownload.viewCart,
        onViewCart: () => router.push(lp('/dashboard/talent/cart')),
      });
    },
    [photosInCart, purchasedPhotoIds, addToCart, bulkDownload, router, lp],
  );

  // ── Bulk delete — talents may only delete their own uploads ─────────────
  const handlePhotosDeleted = useCallback(
    (ids: string[]) => {
      setDeletedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      router.refresh();
    },
    [router],
  );

  const { isDeleting, deleteEligible, notifyNoneEligible } = useBulkContributorDelete({
    shareCode,
    labels: bulkDeleteLabels,
    onDeleted: handlePhotosDeleted,
  });

  const handleBulkDeleteRequest = useCallback(
    (ids: string[]) => {
      const eligible = ids.filter((id) => uploadedPhotoIds.has(id));
      if (eligible.length === 0) {
        notifyNoneEligible();
        return;
      }
      setPendingDeleteIds(eligible);
      setSkippedDeleteCount(ids.length - eligible.length);
      setDeleteDialogOpen(true);
    },
    [uploadedPhotoIds, notifyNoneEligible],
  );

  const handleBulkDeleteConfirm = useCallback(
    () => deleteEligible(pendingDeleteIds, skippedDeleteCount),
    [deleteEligible, pendingDeleteIds, skippedDeleteCount],
  );

  // Only collaborative events where the talent has uploads expose delete.
  const canDeleteOwnPhotos = isCollaborative && Boolean(shareCode) && uploadedPhotoIds.size > 0;

  // ── AI face-search results ─────────────────────────────────────────────
  // Bucket the search's OWN signed matches (complete), not the paginated grid.
  const faceSearch = useFaceSearch();
  const bucketed = useMemo(
    () => buildBuckets(faceSearch.matches, faceSearch.matchedPhotos),
    [faceSearch.matches, faceSearch.matchedPhotos],
  );

  // ── BIB-number search filter (T-069) ───────────────────────────────────
  const bibSearch = useBibSearch();
  const bibActive = bibSearch.matchedPhotoIds !== null;

  // ── "All photos / My photos" filter + bib search ────────────────────────
  const [filter, setFilter] = useState<EventPhotoFilter>('all');

  // Grid mode: one filtered batch per load-more page, laid out as independent
  // segments (no reflow / scroll-jump on append). A bib search instead renders
  // its own complete, signed matched set.
  const gridBatches = useMemo(
    () => filterEventPhotoPages(gridPages, { deletedIds, filter, myPhotoIds: uploadedPhotoIds }),
    [gridPages, deletedIds, filter, uploadedPhotoIds],
  );
  // Reveal gate (T-230): whether ANYTHING is revealed, deliberately independent
  // of the All/My filter — a "My photos" tab that simply has no uploads must not
  // be mistaken for an unproven visitor and answered with the gated panel.
  const hasGridPhotos = useMemo(
    () => gridPages.some((page) => page.some((p) => !deletedIds.has(p.id))),
    [gridPages, deletedIds],
  );
  const bibVisiblePhotos = useMemo(
    () =>
      filterEventPhotos(bibSearch.matchedPhotos, {
        filter,
        myPhotoIds: uploadedPhotoIds,
        bibMatchedIds: null,
      }),
    [bibSearch.matchedPhotos, filter, uploadedPhotoIds],
  );

  const bibEmptyKind = bibSearchEmptyKind(
    bibSearch.matchedPhotoIds,
    bibVisiblePhotos.length,
    bibHasData,
  );

  // The toolbar count reflects what's currently shown: during a bib search
  // that's the number of matches (per All/My tab), not the event total (T-122).
  const { all: displayedAllCount, mine: displayedMineCount } = useMemo(
    () =>
      resolveGalleryCounts({
        bibActive,
        matchedPhotos: bibSearch.matchedPhotos,
        mineIds: uploadedPhotoIds,
        eventTotal: totalCount,
        mineTotal: uploadedPhotoIds.size,
      }),
    [bibActive, bibSearch.matchedPhotos, uploadedPhotoIds, totalCount],
  );

  // ── Per-photo download (lightbox) ──────────────────────────────────────
  const isPhotoDownloadable = useCallback(
    (photoId: string) => isFreeEvent || purchasedPhotoIds.has(photoId),
    [isFreeEvent, purchasedPhotoIds],
  );

  const handleDownloadPhoto = useCallback(
    async (photoId: string) => {
      if (!isPhotoDownloadable(photoId)) {
        toast.error(menuLabels.downloadNotPurchased);
        return;
      }
      try {
        const url = await getEventPhotoDownloadUrlAction(photoId, eventId);
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.click();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : menuLabels.downloadFailed);
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
        addToFavorites: menuLabels.addToFavorites,
        removeFromFavorites: menuLabels.removeFromFavorites,
        addToProfile: menuLabels.addToProfile,
        addedToProfile: menuLabels.addedToProfile,
        addToCart: menuLabels.addToCart,
        removeFromCart: menuLabels.removeFromCart,
        uploadedBy: menuLabels.uploadedBy,
      },
      onDownload: handleDownloadPhoto,
      isDownloadDisabled: (id) => !isPhotoDownloadable(id),
      onFavoriteToggle: handleFavoriteToggle,
      favoritedIds: myPhotos,
      onClaimToProfile: handleClaimToProfile,
      claimedIds: claimedPhotos,
      // Claiming a photo into the profile is only for free photos.
      canClaimToProfile: () => isFreeEvent,
      onCartToggle: handleCartToggle,
      showCartFor: (id) => !isFreeEvent && !purchasedPhotoIds.has(id),
      showUploaderRow: isCollaborative,
    }),
    [
      menuLabels,
      handleDownloadPhoto,
      isPhotoDownloadable,
      handleFavoriteToggle,
      myPhotos,
      handleClaimToProfile,
      claimedPhotos,
      isFreeEvent,
      handleCartToggle,
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
      showAddToPhotos: true,
      photosInMyPhotos: myPhotos,
      onAddToPhotos: handleAddToPhotos,
      onRemoveFromPhotos: handleRemoveFromPhotos,
      showDownload: true,
      isPhotoDownloadable,
      onDownload: handleDownloadPhoto,
      moreMenu,
      onClaimToProfile: handleClaimToProfile,
      claimedIds: claimedPhotos,
      canClaimToProfile: () => isFreeEvent,
      iconTooltips,
      imageUnavailableLabel,
      lightboxActionBar: 'bottom' as const,
      actionBarLabels: {
        download: menuLabels.download,
        addToFavorites: menuLabels.addToFavorites,
        removeFromFavorites: menuLabels.removeFromFavorites,
        addToProfile: menuLabels.addToProfile,
        addedToProfile: menuLabels.addedToProfile,
        addToCart: menuLabels.addToCart,
        removeFromCart: menuLabels.removeFromCart,
        uploadedBy: menuLabels.uploadedBy,
      },
      // Paid events get the two-panel purchase modal; free events keep the
      // lightbox (bigger photo, no purchase moment).
      detailVariant: isFreeEvent ? ('lightbox' as const) : ('purchase' as const),
      pricePerPhoto,
      bundleTiers,
      bundleAllPhotosCents,
      bundleOfferLabels: bundleLabels,
      locale,
      photographerName,
      purchaseLabels: photoDetailLabels,
    }),
    [
      showAddToCart,
      photosInCart,
      handleAddToCart,
      handleRemoveFromCart,
      myPhotos,
      handleAddToPhotos,
      handleRemoveFromPhotos,
      isPhotoDownloadable,
      handleDownloadPhoto,
      moreMenu,
      handleClaimToProfile,
      claimedPhotos,
      isFreeEvent,
      iconTooltips,
      imageUnavailableLabel,
      menuLabels,
      pricePerPhoto,
      bundleTiers,
      bundleAllPhotosCents,
      bundleLabels,
      locale,
      photographerName,
      photoDetailLabels,
    ],
  );

  const bulkActions = useMemo<PhotoGalleryBulkAction[]>(
    () => [
      {
        key: 'cart',
        label: bulkDownload.addToCart,
        icon: ShoppingCart,
        onRun: handleBulkAddToCart,
        // Paid events only — free events have no cart.
        visible: !isFreeEvent && showAddToCart,
      },
      {
        key: 'download',
        label: bulkDownload.download,
        icon: Download,
        onRun: (ids) => downloadSelected(ids),
        isPending: isDownloading,
        // Free events: anyone can download. Paid events: only when the user has
        // purchased photos to download — otherwise hide the dead button instead
        // of showing one that just errors (T-041).
        visible: shouldShowBulkDownload(isFreeEvent, purchasedPhotoIds.size > 0),
      },
      {
        key: 'favorite',
        label: menuLabels.addToFavorites,
        icon: Heart,
        onRun: handleBulkFavorite,
        isPending: isBulkFavoriting,
      },
      {
        key: 'profile',
        label: menuLabels.addToProfile,
        icon: UserRoundPlus,
        onRun: handleBulkClaim,
        isPending: isBulkClaiming,
        visible: isFreeEvent,
      },
      {
        key: 'delete',
        label: bulkDeleteLabels.button,
        icon: Trash2,
        onRun: handleBulkDeleteRequest,
        isPending: isDeleting,
        visible: canDeleteOwnPhotos,
      },
    ],
    [
      bulkDownload.addToCart,
      bulkDownload.download,
      handleBulkAddToCart,
      showAddToCart,
      downloadSelected,
      isDownloading,
      purchasedPhotoIds,
      menuLabels,
      handleBulkFavorite,
      isBulkFavoriting,
      handleBulkClaim,
      isBulkClaiming,
      isFreeEvent,
      bulkDeleteLabels.button,
      handleBulkDeleteRequest,
      isDeleting,
      canDeleteOwnPhotos,
    ],
  );

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

  // -mx-3 exactly cancels the dashboard shell's own `px-3` on mobile (and
  // md:-mx-6 cancels its `md:p-6`) so the toolbar's bled edge lands flush
  // with the viewport. A prior -mx-4 overshot the shell's px-3 by 4px per
  // side (8px total scrollWidth over the viewport, confirmed via DevTools),
  // which mobile browsers rendered as a small, permanent zoom-in on load —
  // real horizontal overflow, not a viewport/scale bug.
  const toolbarClassName = 'sticky top-[var(--header-height)] -mx-3 px-3';
  // Bleed the grid nearly full-width on mobile, leaving a 2px gap at each edge
  // (-mx-3.5 against the page's px-4); padded again from sm up so the toolbar
  // stays the only inset chrome on phones.
  const gridClassName = '-mx-2.5 sm:mx-0';
  const selectionResetKey = `${filter}:${faceSearch.matches === null ? 'all' : 'search'}`;

  // Running bundle price for the current selection (T-204) — undefined (so the
  // toolbar renders unchanged) on an event with no ladder.
  const renderSelectionNote = useBundleSelectionNote({
    pricePerPhoto: pricePerPhoto ?? null,
    bundleTiers,
    bundleAllPhotosCents,
    labels: bundleLabels,
  });

  // ── "Add all my photos" after a face search (T-204) ─────────────────────
  // Ids come from the buyer's OWN match set (`faceSearch.matchedPhotos`, the
  // server's response to their search), never a fresh query for the event's
  // photos — which is what keeps the reveal gate intact: on a gated event that
  // matched set IS the proven set the search minted the reveal token over.
  const faceMatchIds = useMemo(
    () => faceSearch.matchedPhotos.map((p) => p.id),
    [faceSearch.matchedPhotos],
  );
  const addAllMatchedToCart = useCallback(() => {
    handleBulkAddToCart(faceMatchIds);
  }, [handleBulkAddToCart, faceMatchIds]);
  const canAddAllMatched =
    !isFreeEvent && showAddToCart && faceMatchIds.length > 0 && bundleLabels != null;

  // Shared across both render paths (full gallery + AI results) since the
  // delete bulk action is reachable from either.
  const deleteDialog = (
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
          pendingDeleteIds.length === 1 ? bulkDeleteLabels.photoNoun : bulkDeleteLabels.photosNoun,
        )}
      confirmText={bulkDeleteLabels.confirmButton}
      cancelText={bulkDeleteLabels.cancelButton}
      pendingText={bulkDeleteLabels.deletingLabel}
      onConfirm={handleBulkDeleteConfirm}
    />
  );

  // Which view owns the gallery slot (T-230) — the same resolver the public
  // viewer uses, so the two surfaces answer one event identically.
  const galleryView = resolveEventGalleryView({
    hasPhotos: hasGridPhotos,
    faceSearchActive: faceSearch.matches !== null,
    gatedPanel: gatedPanel != null,
  });

  // ── Reveal-gated pre-search panel (T-230) ──────────────────────────────
  // A gated event reveals nothing until the visitor proves a match, so this
  // panel — explanation plus the search CTA — IS the screen, in place of the
  // mute empty grid that used to point at a button somewhere above it.
  if (galleryView === 'gated-panel' && gatedPanel) {
    return (
      <GatedSearchPanel
        state="searchable"
        labels={gatedPanel.labels}
        photoCount={gatedPanel.photoCount}
        onSearch={faceSearch.openSearch}
      />
    );
  }

  // ── AI face-search results view ────────────────────────────────────────
  if (galleryView === 'search-results' && faceSearch.matches !== null) {
    return (
      <div className="space-y-3">
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
              labels={selectionLabels}
              selectionResetKey={selectionResetKey}
              renderSelectionNote={renderSelectionNote}
              toolbarClassName={toolbarClassName}
              gridClassName={gridClassName}
              toolbarLeading={
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={faceSearch.clearMatches}
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" />
                    {resultsLabels.viewAllPhotos}
                  </Button>
                  {canAddAllMatched ? (
                    <Button type="button" size="sm" onClick={addAllMatchedToCart}>
                      <ShoppingCart className="mr-1.5 h-4 w-4" />
                      {bundleLabels?.addAllMyPhotos}
                    </Button>
                  ) : null}
                </div>
              }
            />
          )}
        />
        {deleteDialog}
      </div>
    );
  }

  // ── Full gallery ───────────────────────────────────────────────────────
  return (
    <>
      <PhotoGallery
        items={bibActive ? bibVisiblePhotos : undefined}
        itemBatches={bibActive ? undefined : gridBatches}
        galleryProps={galleryProps}
        bulkActions={bulkActions}
        labels={selectionLabels}
        selectionResetKey={selectionResetKey}
        renderSelectionNote={renderSelectionNote}
        toolbarClassName={toolbarClassName}
        gridClassName={gridClassName}
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
          bibEmptyKind !== null && bibEmptyLabels ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">
                {bibEmptyKind === 'pending' ? bibEmptyLabels.pending : bibEmptyLabels.noMatch}
              </p>
            </div>
          ) : filter === 'mine' ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">{filterLabels.empty}</p>
            </div>
          ) : undefined
        }
      />
      {deleteDialog}
    </>
  );
}
