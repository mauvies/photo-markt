'use client';

import {
  Download,
  Fullscreen,
  Heart,
  Maximize2,
  Share2,
  ShoppingCart,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { untagPhotoForTalentAction } from '@/app/[lang]/dashboard/photographer/events/[id]/actions';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PhotoLightboxItem } from './photo-lightbox';

const TOOLBAR_TRANSLATIONS: Record<
  string,
  {
    share: string;
    download: string;
    removeFromPhotos: string;
    addToPhotos: string;
    removeFromCart: string;
    addToCart: string;
    remove: string;
    tagRemoved: string;
  }
> = {
  en: {
    share: 'Share',
    download: 'Download',
    removeFromPhotos: 'Remove from photos',
    addToPhotos: 'Add to photos',
    removeFromCart: 'Remove from cart',
    addToCart: 'Add to cart',
    remove: 'Remove',
    tagRemoved: 'Tag removed',
  },
  es: {
    share: 'Compartir',
    download: 'Descargar',
    removeFromPhotos: 'Eliminar de fotos',
    addToPhotos: 'Añadir a fotos',
    removeFromCart: 'Eliminar del carrito',
    addToCart: 'Añadir al carrito',
    remove: 'Eliminar',
    tagRemoved: 'Etiqueta eliminada',
  },
};

type LightboxToolbarProps = {
  visible: boolean;
  currentPhoto: PhotoLightboxItem;
  itemCount: number;
  currentIndex: number;
  isFullscreen: boolean;
  isInMyPhotos: boolean | undefined;
  isInCart: boolean | undefined;
  showDownload: boolean;
  showAddToPhotos: boolean;
  showAddToCart: boolean;
  showRemove: boolean;
  showTagTalent: boolean;
  onClose: () => void;
  onShare: () => void;
  onDownload: () => void;
  onAddToPhotos: () => void;
  onAddToCart: () => void;
  onRemove: () => void;
  onTagTalent: () => void;
  onUntag?: () => void;
  onFullscreen: () => void;
};

export function LightboxToolbar({
  visible,
  currentPhoto,
  itemCount,
  currentIndex,
  isFullscreen,
  isInMyPhotos,
  isInCart,
  showDownload,
  showAddToPhotos,
  showAddToCart,
  showRemove,
  showTagTalent,
  onClose,
  onShare,
  onDownload,
  onAddToPhotos,
  onAddToCart,
  onRemove,
  onTagTalent,
  onUntag,
  onFullscreen,
}: LightboxToolbarProps) {
  const params = useParams();
  const lang = (params?.lang as string) ?? 'es';
  const t = TOOLBAR_TRANSLATIONS[lang] ?? TOOLBAR_TRANSLATIONS.es;

  const [isTagPopoverOpen, setIsTagPopoverOpen] = useState(false);
  const [isUntagging, startUntagging] = useTransition();

  const hasTags = (currentPhoto.tags?.length ?? 0) > 0;

  const handleUntag = (talentUserId: string) => {
    startUntagging(async () => {
      try {
        await untagPhotoForTalentAction(currentPhoto.id, talentUserId);
        toast.success(t.tagRemoved);
        onUntag?.();
      } catch (error) {
        console.error('Error untagging photo:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
      }
    });
  };

  return (
    <div
      className={`absolute top-0 left-0 right-0 z-30 flex h-16 items-center px-4 transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{ justifyContent: isFullscreen ? 'flex-end' : 'space-between' }}
    >
      {/* Gradient overlay */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/60 via-black/25 to-transparent" />

      {/* Counter */}
      {itemCount > 1 && (
        <div className="absolute left-1/2 -translate-x-1/2 text-sm text-white pointer-events-none">
          {currentIndex + 1} / {itemCount}
        </div>
      )}

      {/* Close */}
      {!isFullscreen && (
        <div className="relative z-10">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="h-12 w-12 text-white hover:bg-white/15"
            aria-label="Close"
          >
            <X className="h-7 w-7" strokeWidth={1.5} />
          </Button>
        </div>
      )}

      {/* Right-side action buttons */}
      <div className="relative z-10 flex items-center gap-2">
        {/* Share */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onShare();
              }}
              className="h-9 w-9 text-white hover:bg-white/15"
              aria-label="Share"
            >
              <Share2 className="h-5 w-5" strokeWidth={1.5} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t.share}</p>
          </TooltipContent>
        </Tooltip>

        {/* Download */}
        {showDownload && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className="h-9 w-9 text-white hover:bg-white/15"
                aria-label="Download"
              >
                <Download className="h-5 w-5" strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t.download}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Add to Photos */}
        {showAddToPhotos && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToPhotos();
                }}
                className="h-9 w-9 text-white hover:bg-white/15"
                aria-label="Add to photos"
              >
                <Heart
                  className="h-5 w-5"
                  strokeWidth={1.5}
                  fill={isInMyPhotos ? 'white' : 'none'}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isInMyPhotos ? t.removeFromPhotos : t.addToPhotos}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Add to Cart */}
        {showAddToCart && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToCart();
                }}
                className="h-9 w-9 text-white hover:bg-white/15"
                aria-label="Add to cart"
              >
                <ShoppingCart
                  className="h-5 w-5"
                  strokeWidth={1.5}
                  fill={isInCart ? 'white' : 'none'}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isInCart ? t.removeFromCart : t.addToCart}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Remove */}
        {showRemove && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                className="h-9 w-9 text-white hover:bg-white/15"
                aria-label="Remove"
              >
                <Trash2 className="h-5 w-5" strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t.remove}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Tag Talent */}
        {showTagTalent &&
          (hasTags ? (
            <Popover open={isTagPopoverOpen} onOpenChange={setIsTagPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-white hover:bg-white/15"
                  aria-label="Tagged people"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Users className="h-5 w-5" strokeWidth={1.5} />
                  {currentPhoto.tags && currentPhoto.tags.length > 1 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                      {currentPhoto.tags.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-64 p-3"
                side="bottom"
                align="end"
                onClick={(e) => e.stopPropagation()}
                onPointerEnter={(e) => e.stopPropagation()}
              >
                <div className="space-y-1.5">
                  {currentPhoto.tags?.map((tag) => (
                    <div
                      key={tag.tag_id}
                      className="group flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">@{tag.talent_username}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUntag(tag.talent_user_id);
                        }}
                        disabled={isUntagging}
                        className="ml-2 rounded p-1 hover:text-destructive disabled:opacity-50"
                        aria-label={`Remove tag for ${tag.talent_username}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {onTagTalent && (
                    <div className="mt-1.5 border-t pt-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTagTalent();
                          setIsTagPopoverOpen(false);
                        }}
                        className="flex w-full items-center rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        <UserPlus className="mr-2 h-4 w-4" />
                        Tag new people
                      </button>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagTalent();
                  }}
                  className="h-9 w-9 text-white hover:bg-white/15"
                  aria-label="Tag talent"
                >
                  <UserPlus className="h-5 w-5" strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Tag talent</p>
              </TooltipContent>
            </Tooltip>
          ))}

        {/* Fullscreen */}
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onFullscreen();
          }}
          className="h-9 w-9 text-white hover:bg-white/15"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <Fullscreen className="h-5 w-5" strokeWidth={1.5} />
          ) : (
            <Maximize2 className="h-5 w-5" strokeWidth={1.5} />
          )}
        </Button>
      </div>
    </div>
  );
}
