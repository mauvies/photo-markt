'use client';

import {
  Camera,
  Download,
  Heart,
  MoreVertical,
  Share2,
  ShoppingCart,
  Trash2,
  UserPlus,
  UserRoundPlus,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { photoActionIconClass } from '@/components/ui/photo-action-icon';
import { cn } from '@/lib/utils';

export interface PhotoMoreMenuLabels {
  trigger: string;
  download: string;
  /** Each label is only required when its matching handler/field is provided. */
  delete?: string;
  tagPeople?: string;
  share?: string;
  /** Favorites toggle (bookmarks). */
  addToFavorites?: string;
  removeFromFavorites?: string;
  /** Profile claim — `addToProfile` when claimable, `addedToProfile` once claimed. */
  addToProfile?: string;
  addedToProfile?: string;
  addToCart?: string;
  removeFromCart?: string;
  /** "Uploaded by {name}" template — `{name}` is substituted. */
  uploadedBy?: string;
}

interface PhotoMoreMenuProps {
  photoId: string;
  labels: PhotoMoreMenuLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: (photoId: string) => void;
  /** Disables the Download item — e.g. a paid photo the viewer hasn't bought. */
  downloadDisabled?: boolean;
  /** Photographer items — render only when their handler is provided. */
  onDelete?: (photoId: string) => void;
  onTagPeople?: (photoId: string) => void;
  onShare?: (photoId: string) => void;
  /** Favorites toggle (bookmarks) — renders only when provided. */
  onFavoriteToggle?: (photoId: string) => void;
  isFavorited?: boolean;
  /** Profile claim (acquire a free photo) — renders only when `canClaimToProfile`. */
  onClaimToProfile?: (photoId: string) => void;
  canClaimToProfile?: boolean;
  isClaimed?: boolean;
  /** Cart toggle — renders only when provided. */
  onCartToggle?: (photoId: string) => void;
  isInCart?: boolean;
  /** When set, a non-interactive "Uploaded by {name}" info row is shown. */
  uploaderName?: string;
}

/**
 * Three-dot "more options" menu for a photo tile — the trigger matches the
 * PhotoActionIcon pattern (dark pill, white icon). The trigger stops event
 * propagation so opening the menu never toggles selection or the lightbox.
 *
 * Items are à la carte — each renders only when its handler/field is passed.
 * Favorites (a bookmark toggle) and "Add to my profile" (claiming a free
 * photo into the owned collection) are independent items: favorites is a
 * toggle for any photo; the claim item shows only on free photos and, once
 * claimed, becomes a disabled "Added to profile". Download always renders.
 */
export function PhotoMoreMenu({
  photoId,
  labels,
  open,
  onOpenChange,
  onDownload,
  downloadDisabled = false,
  onDelete,
  onTagPeople,
  onShare,
  onFavoriteToggle,
  isFavorited = false,
  onClaimToProfile,
  canClaimToProfile = false,
  isClaimed = false,
  onCartToggle,
  isInCart = false,
  uploaderName,
}: PhotoMoreMenuProps) {
  const favoriteLabel = isFavorited ? labels.removeFromFavorites : labels.addToFavorites;
  const claimLabel = isClaimed ? labels.addedToProfile : labels.addToProfile;
  const cartLabel = isInCart ? labels.removeFromCart : labels.addToCart;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        type="button"
        aria-label={labels.trigger}
        className={cn(photoActionIconClass, open && 'bg-gray-900/80')}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <MoreVertical className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        // The menu content is portaled, but React events still bubble through
        // the component tree — without this a click on any item would also
        // reach the photo card's onClick (opening the lightbox behind it).
        onClick={(e) => e.stopPropagation()}
      >
        {onFavoriteToggle && favoriteLabel ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => onFavoriteToggle(photoId)}>
            <Heart className={cn('mr-2 h-4 w-4', isFavorited && 'fill-current')} />
            {favoriteLabel}
          </DropdownMenuItem>
        ) : null}
        {onClaimToProfile && canClaimToProfile && claimLabel ? (
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={isClaimed}
            onSelect={() => onClaimToProfile(photoId)}
          >
            <UserRoundPlus className="mr-2 h-4 w-4" />
            {claimLabel}
          </DropdownMenuItem>
        ) : null}
        {onCartToggle && cartLabel ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => onCartToggle(photoId)}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            {cartLabel}
          </DropdownMenuItem>
        ) : null}
        {onDelete && labels.delete ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => onDelete(photoId)}>
            <Trash2 className="mr-2 h-4 w-4" />
            {labels.delete}
          </DropdownMenuItem>
        ) : null}
        {onTagPeople && labels.tagPeople ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => onTagPeople(photoId)}>
            <UserPlus className="mr-2 h-4 w-4" />
            {labels.tagPeople}
          </DropdownMenuItem>
        ) : null}
        {onShare && labels.share ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => onShare(photoId)}>
            <Share2 className="mr-2 h-4 w-4" />
            {labels.share}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="cursor-pointer"
          disabled={downloadDisabled}
          onSelect={() => onDownload(photoId)}
        >
          <Download className="mr-2 h-4 w-4" />
          {labels.download}
        </DropdownMenuItem>
        {uploaderName && labels.uploadedBy ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
              <Camera className="h-4 w-4 shrink-0" />
              <span className="truncate">{labels.uploadedBy.replace('{name}', uploaderName)}</span>
            </DropdownMenuLabel>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
