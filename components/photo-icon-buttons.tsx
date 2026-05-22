'use client';

import { useCallback } from 'react';
import { PhotoMoreMenu, type PhotoMoreMenuLabels } from '@/components/photo-more-menu';
import { PhotoTagsIndicator } from '@/components/photo-tags-indicator';
import {
  PhotoUploaderIndicator,
  type PhotoUploaderInfo,
} from '@/components/photo-uploader-indicator';
import { PhotoActionIcon } from '@/components/ui/photo-action-icon';
import { cn } from '@/lib/utils';

/**
 * Optional "more options" 3-dot menu config. When provided, the menu renders
 * in the top-right and the standalone tag-add + delete icons are suppressed
 * (their actions move into the menu). Used for collaborative events on the
 * photographer dashboard.
 */
export interface PhotoMoreMenuConfig {
  labels: PhotoMoreMenuLabels;
  /** Each item appears only when its handler is set. */
  onDelete?: (photoId: string) => void;
  onTagPeople?: (photoId: string) => void;
  onShare?: (photoId: string) => void;
  onDownload: (photoId: string) => void;
  /** Per-photo predicate — when it returns true the Download item is hidden. */
  isDownloadDisabled?: (photoId: string) => boolean;
  /** Favorites toggle (bookmarks) — moves the standalone heart into the menu. */
  onFavoriteToggle?: (photoId: string) => void;
  favoritedIds?: Set<string>;
  /** Profile claim — acquire a free photo into the owned collection. */
  onClaimToProfile?: (photoId: string) => void;
  claimedIds?: Set<string>;
  /** Per-photo predicate — when true the claim item shows (free photos only). */
  canClaimToProfile?: (photoId: string) => boolean;
  /** Cart toggle — moves the standalone cart icon into the menu. */
  onCartToggle?: (photoId: string) => void;
  /** Per-photo predicate — when true the cart item shows (paid && not purchased). */
  showCartFor?: (photoId: string) => boolean;
  /** When true, the uploader attribution moves into the menu as an info row. */
  showUploaderRow?: boolean;
}

export interface PhotoIconTooltips {
  addToCart: string;
  removeFromCart: string;
  selectPhoto: string;
  tagPeople: string;
  nPeopleTagged: string;
  saveToPhotos: string;
  removeFromMyPhotos: string;
}

const DEFAULT_TOOLTIPS: PhotoIconTooltips = {
  addToCart: 'Add to cart',
  removeFromCart: 'Remove from cart',
  selectPhoto: 'Select photo',
  tagPeople: 'Tag people',
  nPeopleTagged: '{n} people tagged',
  saveToPhotos: 'Save to my photos',
  removeFromMyPhotos: 'Remove from my photos',
};

// Applied to every icon wrapper: visible on mobile, hidden on desktop until group-hover.
// Active overrides add md:opacity-100 to always show regardless of hover.
const ICON_WRAP =
  'pointer-events-auto transition-opacity duration-150 opacity-100 md:opacity-0 md:group-hover:opacity-100';

interface PhotoIconButtonsProps {
  photoId: string;
  isSelected?: boolean;
  hasTags?: boolean;
  tags?: Array<{
    tag_id: string;
    talent_user_id: string;
    talent_username: string;
    talent_display_name: string | null;
    tagged_at: string;
  }>;
  uploader?: PhotoUploaderInfo;
  uploaderLabels?: {
    tooltip: string;
    popoverHeading: string;
  };
  canDelete?: boolean;
  onDelete?: (photoId: string) => void;
  deleteTooltip?: string;
  isPopoverOpen?: boolean;
  onPopoverOpenChange?: (open: boolean) => void;
  canSelect?: boolean;
  onToggleSelect?: (photoId: string) => void;
  selectionActive?: boolean;
  onTagPhoto?: (photoId: string) => void;
  onUntag?: () => void;
  showAddToCart?: boolean;
  photosInCart?: Set<string>;
  onAddToCart?: (photoId: string) => void;
  onRemoveFromCart?: (photoId: string) => void;
  showAddToPhotos?: boolean;
  photosInMyPhotos?: Set<string>;
  onAddToPhotos?: (photoId: string) => void;
  onRemoveFromPhotos?: (photoId: string) => void;
  /** When set, renders the 3-dot menu and hides the standalone tag/delete icons. */
  moreMenu?: PhotoMoreMenuConfig;
  /**
   * Controlled open-state for the 3-dot menu. Lifted to the grid so only one
   * photo's menu can be open at a time.
   */
  moreMenuOpen?: boolean;
  onMoreMenuOpenChange?: (open: boolean) => void;
  className?: string;
  tooltips?: Partial<PhotoIconTooltips>;
}

export function PhotoIconButtons({
  photoId,
  isSelected = false,
  hasTags = false,
  tags = [],
  uploader,
  uploaderLabels,
  canDelete = false,
  onDelete,
  deleteTooltip,
  isPopoverOpen = false,
  onPopoverOpenChange,
  canSelect = false,
  onToggleSelect,
  selectionActive = false,
  onTagPhoto,
  onUntag,
  showAddToCart = false,
  photosInCart = new Set(),
  onAddToCart,
  onRemoveFromCart,
  showAddToPhotos = false,
  photosInMyPhotos = new Set(),
  onAddToPhotos,
  onRemoveFromPhotos,
  moreMenu,
  moreMenuOpen = false,
  onMoreMenuOpenChange = () => {},
  className,
  tooltips,
}: PhotoIconButtonsProps) {
  const tt: PhotoIconTooltips = { ...DEFAULT_TOOLTIPS, ...tooltips };
  const hasAnyOpen = isPopoverOpen || moreMenuOpen;
  const inCart = photosInCart.has(photoId);
  const inMyPhotos = photosInMyPhotos.has(photoId);

  const handleToggleSelect = useCallback(() => {
    onToggleSelect?.(photoId);
  }, [photoId, onToggleSelect]);

  const handleTagClick = useCallback(() => {
    onTagPhoto?.(photoId);
  }, [photoId, onTagPhoto]);

  const handleHeartClick = useCallback(() => {
    if (inMyPhotos) {
      onRemoveFromPhotos?.(photoId);
    } else {
      onAddToPhotos?.(photoId);
    }
  }, [photoId, inMyPhotos, onAddToPhotos, onRemoveFromPhotos]);

  const handleCartClick = useCallback(() => {
    if (inCart) {
      onRemoveFromCart?.(photoId);
    } else {
      onAddToCart?.(photoId);
    }
  }, [photoId, inCart, onAddToCart, onRemoveFromCart]);

  const handleDeleteClick = useCallback(() => {
    onDelete?.(photoId);
  }, [photoId, onDelete]);

  const tagTooltip = hasTags ? tt.nPeopleTagged.replace('{n}', String(tags.length)) : tt.tagPeople;

  return (
    // pointer-events-none so the overlay div doesn't absorb clicks on the photo itself.
    // Individual wrapper divs re-enable pointer events for interactive icons.
    <div
      className={cn(
        'pointer-events-none absolute inset-0 flex flex-col items-start justify-between p-2',
        className,
      )}
    >
      {/* Gradient overlays for ambient photo contrast */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-14 bg-linear-to-b from-black/30 via-black/10 to-transparent z-0 opacity-0 transition-opacity group-hover:opacity-100',
          hasAnyOpen && 'opacity-100',
        )}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-black/30 via-black/10 to-transparent z-0 opacity-0 transition-opacity group-hover:opacity-100',
          hasAnyOpen && 'opacity-100',
        )}
      />

      {/* Top row: Select (left) and Cart (right) */}
      <div className="relative z-10 flex w-full items-start justify-between">
        {/* Select button — visible on hover; always visible when selected */}
        {canSelect && (
          <div className={cn(ICON_WRAP, (isSelected || hasAnyOpen) && 'md:opacity-100')}>
            <PhotoActionIcon
              icon="check"
              active={isSelected}
              onClick={handleToggleSelect}
              tooltip={tt.selectPhoto}
            />
          </div>
        )}

        {/* Right side: cart button and the 3-dot "more options" menu. */}
        <div className="ml-auto flex items-start gap-1.5">
          {showAddToCart && !selectionActive && !moreMenu?.onCartToggle && (
            <div className={cn(ICON_WRAP, (inCart || hasAnyOpen) && 'md:opacity-100')}>
              <PhotoActionIcon
                icon="cart"
                active={inCart}
                onClick={handleCartClick}
                tooltip={inCart ? tt.removeFromCart : tt.addToCart}
              />
            </div>
          )}
          {moreMenu && !selectionActive && (
            <div className={cn(ICON_WRAP, (moreMenuOpen || hasAnyOpen) && 'md:opacity-100')}>
              <PhotoMoreMenu
                photoId={photoId}
                labels={moreMenu.labels}
                open={moreMenuOpen}
                onOpenChange={onMoreMenuOpenChange}
                onDownload={moreMenu.onDownload}
                downloadDisabled={moreMenu.isDownloadDisabled?.(photoId) ?? false}
                onDelete={moreMenu.onDelete}
                onTagPeople={moreMenu.onTagPeople}
                onShare={moreMenu.onShare}
                onFavoriteToggle={moreMenu.onFavoriteToggle}
                isFavorited={moreMenu.favoritedIds?.has(photoId) ?? false}
                onClaimToProfile={moreMenu.onClaimToProfile}
                canClaimToProfile={moreMenu.canClaimToProfile?.(photoId) ?? false}
                isClaimed={moreMenu.claimedIds?.has(photoId) ?? false}
                onCartToggle={moreMenu.showCartFor?.(photoId) ? moreMenu.onCartToggle : undefined}
                isInCart={inCart}
                uploaderName={moreMenu.showUploaderRow ? uploader?.name : undefined}
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: Tag (left) + Heart (right) */}
      {!selectionActive && (
        <div className="relative z-10 mt-auto flex w-full items-end justify-between">
          {/* Tag button */}
          <div className="pointer-events-auto">
            {onTagPhoto && !hasTags && !moreMenu?.onTagPeople && (
              <div className={cn(ICON_WRAP, hasAnyOpen && 'md:opacity-100')}>
                <PhotoActionIcon
                  icon="tag"
                  active={false}
                  onClick={handleTagClick}
                  tooltip={tt.tagPeople}
                />
              </div>
            )}
            {onTagPhoto && hasTags && (
              // Always visible when tags exist (active state)
              <div
                className={cn(
                  'pointer-events-auto transition-opacity duration-150',
                  hasAnyOpen
                    ? 'opacity-100'
                    : 'opacity-100 md:opacity-0 md:group-hover:opacity-100',
                )}
              >
                <PhotoTagsIndicator
                  tags={tags}
                  photoId={photoId}
                  onUntag={onUntag}
                  onTagPhoto={onTagPhoto}
                  isDropdownOpen={isPopoverOpen}
                  onDropdownOpenChange={onPopoverOpenChange}
                  tooltip={tagTooltip}
                />
              </div>
            )}
          </div>

          {/* Right cluster: uploader badge, Heart / Save and contributor Delete */}
          <div className="flex items-end gap-1.5">
            {uploader && !moreMenu?.showUploaderRow && (
              <div
                className={cn(
                  'pointer-events-auto transition-opacity duration-150',
                  hasAnyOpen
                    ? 'opacity-100'
                    : 'opacity-100 md:opacity-0 md:group-hover:opacity-100',
                )}
              >
                <PhotoUploaderIndicator
                  uploader={uploader}
                  tooltip={uploaderLabels?.tooltip}
                  popoverHeading={uploaderLabels?.popoverHeading}
                  isPopoverOpen={isPopoverOpen}
                  onPopoverOpenChange={onPopoverOpenChange}
                />
              </div>
            )}
            {showAddToPhotos && !moreMenu?.onFavoriteToggle && (
              <div className={cn(ICON_WRAP, (inMyPhotos || hasAnyOpen) && 'md:opacity-100')}>
                <PhotoActionIcon
                  icon="save"
                  active={inMyPhotos}
                  onClick={handleHeartClick}
                  tooltip={inMyPhotos ? tt.removeFromMyPhotos : tt.saveToPhotos}
                />
              </div>
            )}
            {canDelete && onDelete && !moreMenu?.onDelete && (
              <div className={cn(ICON_WRAP, hasAnyOpen && 'md:opacity-100')}>
                <PhotoActionIcon
                  icon="delete"
                  active={false}
                  onClick={handleDeleteClick}
                  tooltip={deleteTooltip ?? 'Delete'}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
