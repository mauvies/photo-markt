'use client';

import type { LucideIcon } from 'lucide-react';
import { Download, Heart, ShoppingCart, Trash2, UserPlus, UserRoundPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Localized copy for the lightbox bottom action bar. Every field is optional —
 * a viewer only supplies the labels for the actions it actually enables. */
export interface LightboxActionLabels {
  download?: string;
  addToFavorites?: string;
  removeFromFavorites?: string;
  addToProfile?: string;
  addedToProfile?: string;
  addToCart?: string;
  removeFromCart?: string;
  remove?: string;
  tagPeople?: string;
  /** "Uploaded by {name}" template — `{name}` is substituted. */
  uploadedBy?: string;
}

interface LightboxActionBarProps {
  visible: boolean;
  labels: LightboxActionLabels;
  /** Collaborative events — shows an "Uploaded by {name}" caption. */
  uploaderName?: string;
  showDownload?: boolean;
  onDownload?: () => void;
  showFavorite?: boolean;
  isFavorited?: boolean;
  onFavorite?: () => void;
  showClaim?: boolean;
  isClaimed?: boolean;
  onClaim?: () => void;
  showCart?: boolean;
  isInCart?: boolean;
  onCart?: () => void;
  showRemove?: boolean;
  onRemove?: () => void;
  showTag?: boolean;
  onTag?: () => void;
}

function ActionButton({
  icon: Icon,
  label,
  filled = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  filled?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex min-w-16 shrink-0 flex-col items-center gap-1 rounded-md px-2 py-1 text-white transition-colors hover:bg-white/15 disabled:opacity-50"
    >
      <Icon className={cn('h-5 w-5', filled && 'fill-current')} strokeWidth={1.5} />
      <span className="whitespace-nowrap text-[11px] leading-tight">{label}</span>
    </button>
  );
}

/**
 * Bottom action bar for the lightbox — hosts the per-photo actions
 * (download / favorites / add-to-profile / cart / remove / tag), with an
 * "Uploaded by" caption on collaborative events. Each action is à la carte
 * via its `show*` flag. Used by the event galleries' lightbox; the toolbar's
 * top action cluster is hidden when this bar is active.
 */
export function LightboxActionBar({
  visible,
  labels,
  uploaderName,
  showDownload = false,
  onDownload,
  showFavorite = false,
  isFavorited = false,
  onFavorite,
  showClaim = false,
  isClaimed = false,
  onClaim,
  showCart = false,
  isInCart = false,
  onCart,
  showRemove = false,
  onRemove,
  showTag = false,
  onTag,
}: LightboxActionBarProps) {
  const favoriteLabel = isFavorited ? labels.removeFromFavorites : labels.addToFavorites;
  const claimLabel = isClaimed ? labels.addedToProfile : labels.addToProfile;
  const cartLabel = isInCart ? labels.removeFromCart : labels.addToCart;

  return (
    <div
      className={cn(
        'absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-200',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/60 via-black/25 to-transparent" />
      <div className="relative z-10 flex flex-col gap-1 px-4 pt-8 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        {uploaderName && labels.uploadedBy ? (
          <p className="truncate text-xs text-white/80">
            {labels.uploadedBy.replace('{name}', uploaderName)}
          </p>
        ) : null}
        <div className="flex items-center justify-around gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {showDownload && onDownload && labels.download ? (
            <ActionButton icon={Download} label={labels.download} onClick={onDownload} />
          ) : null}
          {showFavorite && onFavorite && favoriteLabel ? (
            <ActionButton
              icon={Heart}
              label={favoriteLabel}
              filled={isFavorited}
              onClick={onFavorite}
            />
          ) : null}
          {showClaim && onClaim && claimLabel ? (
            <ActionButton
              icon={UserRoundPlus}
              label={claimLabel}
              disabled={isClaimed}
              onClick={onClaim}
            />
          ) : null}
          {showCart && onCart && cartLabel ? (
            <ActionButton
              icon={ShoppingCart}
              label={cartLabel}
              filled={isInCart}
              onClick={onCart}
            />
          ) : null}
          {showRemove && onRemove && labels.remove ? (
            <ActionButton icon={Trash2} label={labels.remove} onClick={onRemove} />
          ) : null}
          {showTag && onTag && labels.tagPeople ? (
            <ActionButton icon={UserPlus} label={labels.tagPeople} onClick={onTag} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
