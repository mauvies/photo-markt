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
  /** Save-to-library — `saveToProfile` on free photos, `saveToPhotos` on paid. */
  saveToProfile?: string;
  saveToPhotos?: string;
  removeFromLibrary?: string;
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
  /** Talent "save to my library" toggle — renders only when provided. */
  onSaveToggle?: (photoId: string) => void;
  isSaved?: boolean;
  /** Picks the add label when not saved: "Add to my profile" vs "Add to my photos". */
  saveLabelVariant?: 'profile' | 'photos';
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
 * Items are à la carte — each renders only when its handler/field is passed,
 * so the photographer (Delete/Tag/Share) and the talent/public viewer
 * (Save/Cart/Uploaded-by) configs share one component. Download always renders.
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
  onSaveToggle,
  isSaved = false,
  saveLabelVariant = 'photos',
  onCartToggle,
  isInCart = false,
  uploaderName,
}: PhotoMoreMenuProps) {
  const saveLabel = isSaved
    ? labels.removeFromLibrary
    : saveLabelVariant === 'profile'
      ? labels.saveToProfile
      : labels.saveToPhotos;
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
      <DropdownMenuContent align="end" sideOffset={6}>
        {onSaveToggle && saveLabel ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => onSaveToggle(photoId)}>
            <Heart className={cn('mr-2 h-4 w-4', isSaved && 'fill-current')} />
            {saveLabel}
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
