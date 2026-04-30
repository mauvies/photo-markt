'use client';

import { useCallback } from 'react';
import { PhotoTagsIndicator } from '@/components/photo-tags-indicator';
import { PhotoActionIcon } from '@/components/ui/photo-action-icon';
import { cn } from '@/lib/utils';

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
  className?: string;
  tooltips?: Partial<PhotoIconTooltips>;
}

export function PhotoIconButtons({
  photoId,
  isSelected = false,
  hasTags = false,
  tags = [],
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
  className,
  tooltips,
}: PhotoIconButtonsProps) {
  const tt: PhotoIconTooltips = { ...DEFAULT_TOOLTIPS, ...tooltips };
  const hasAnyOpen = isPopoverOpen;
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

        {/* Cart button — visible on hover; always visible when in cart */}
        <div className="ml-auto flex items-start gap-1.5">
          {showAddToCart && !selectionActive && (
            <div className={cn(ICON_WRAP, (inCart || hasAnyOpen) && 'md:opacity-100')}>
              <PhotoActionIcon
                icon="cart"
                active={inCart}
                onClick={handleCartClick}
                tooltip={inCart ? tt.removeFromCart : tt.addToCart}
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
            {onTagPhoto && !hasTags && (
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

          {/* Heart / Save button — visible on hover; always visible when saved */}
          {showAddToPhotos && (
            <div className={cn(ICON_WRAP, (inMyPhotos || hasAnyOpen) && 'md:opacity-100')}>
              <PhotoActionIcon
                icon="save"
                active={inMyPhotos}
                onClick={handleHeartClick}
                tooltip={inMyPhotos ? tt.removeFromMyPhotos : tt.saveToPhotos}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
