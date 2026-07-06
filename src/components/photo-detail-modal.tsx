'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Calendar,
  Camera,
  Download,
  MapPin,
  Maximize2,
  Share2,
  ShoppingCart,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { PhotoCarousel } from '@/components/photo-carousel';
import type { PhotoUploaderInfo } from '@/components/photo-uploader-indicator';
import { Button } from '@/components/ui/button';
import { useCarouselNavigation } from '@/hooks/use-carousel-navigation';
import { useImageLoad } from '@/hooks/use-image-load';
import { useKeyboardNav } from '@/hooks/use-keyboard-nav';
import { resolvePhotoCta } from '@/lib/photo-detail-cta';

export interface PhotoDetailModalLabels {
  /** Screen-reader dialog title. */
  title: string;
  pricePerPhoto: string;
  addToCart: string;
  inCart: string;
  download: string;
  share: string;
  close: string;
}

export interface PhotoDetailModalItem {
  id: string;
  url: string;
  thumbMedium?: string;
  alt?: string;
  width?: number;
  height?: number;
  uploader?: PhotoUploaderInfo;
  /** City / state / country label. */
  location?: string;
  /** ISO capture date. */
  takenAt?: string;
}

interface PhotoDetailModalProps {
  items: PhotoDetailModalItem[];
  open: boolean;
  initialIndex?: number;
  onClose: () => void;
  onIndexChange?: (photoId: string) => void;
  labels: PhotoDetailModalLabels;
  /** BCP-47 locale for date formatting (the page `lang`). */
  locale: string;
  /** Flat event price in dollars; `null`/omitted hides the price row. */
  pricePerPhoto?: number | null;
  // Action matrix — the same flags/gates the viewer computes for the lightbox.
  showAddToCart?: boolean;
  showDownload?: boolean;
  canDownloadPhoto?: (photoId: string) => boolean;
  photosInCart?: Set<string>;
  onAddToCart?: (photoId: string) => void;
  onRemoveFromCart?: (photoId: string) => void;
  onDownload?: (photoId: string) => void;
  onShare?: (photoId: string) => void;
}

function formatDate(iso: string | undefined, locale: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** One icon + value row in the info panel. */
function MetaRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-neutral-700">
      <span className="shrink-0 text-neutral-400">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/**
 * Two-panel, conversion-focused photo detail for PAID purchase surfaces
 * (public + talent event views, AI search results). A large image (shared
 * `PhotoCarousel`) dominates the left; a narrow white info/CTA panel on the
 * right lists attribution, location, date, and dimensions (each with an icon)
 * and pins the price + primary button to the bottom. Free events keep the
 * lightbox — see `PhotoAlbumViewer`'s `detailVariant`.
 */
export function PhotoDetailModal({
  items,
  open,
  initialIndex = 0,
  onClose,
  onIndexChange,
  labels,
  locale,
  pricePerPhoto,
  showAddToCart = false,
  showDownload = false,
  canDownloadPhoto,
  photosInCart = new Set(),
  onAddToCart,
  onRemoveFromCart,
  onDownload,
  onShare,
}: PhotoDetailModalProps) {
  const nav = useCarouselNavigation({ items, open, initialIndex, onIndexChange });
  const { isLoaded, markLoaded } = useImageLoad();
  const current = nav.currentItem;

  // The Dialog owns Escape/backdrop close; wire only the arrow keys here.
  useKeyboardNav({ enabled: open, onPrevious: nav.previous, onNext: nav.next });

  if (!current) return null;

  const isInCart = photosInCart.has(current.id);
  const cta = resolvePhotoCta({
    showAddToCart,
    showDownload,
    isDownloadable: canDownloadPhoto?.(current.id) ?? false,
    isInCart,
  });

  const handleShare = () => {
    if (onShare) {
      onShare(current.id);
      return;
    }
    if (!current.url) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: current.alt || 'Photo', url: current.url }).catch(() => {
        navigator.clipboard?.writeText(current.url).catch(() => {});
      });
    } else if (typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(current.url).catch(() => {});
    }
  };

  const dimensions =
    current.width && current.height ? `${current.width} × ${current.height}px` : undefined;
  const dateLabel = formatDate(current.takenAt, locale);
  const priceLabel =
    pricePerPhoto != null && pricePerPhoto > 0 ? `${pricePerPhoto.toFixed(2)} USD` : undefined;

  const renderCta = () => {
    switch (cta) {
      case 'add-to-cart':
        return (
          <Button size="lg" className="w-full" onClick={() => onAddToCart?.(current.id)}>
            <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />
            {labels.addToCart}
          </Button>
        );
      case 'in-cart':
        return (
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            onClick={() => onRemoveFromCart?.(current.id)}
          >
            <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />
            {labels.inCart}
          </Button>
        );
      case 'download':
        return (
          <Button size="lg" className="w-full" onClick={() => onDownload?.(current.id)}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {labels.download}
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        {/* Darker + blurred backdrop so the gallery behind is unreadable. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 flex h-[92dvh] w-[96vw] max-w-[1400px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl shadow-2xl duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 md:flex-row">
          <DialogPrimitive.Title className="sr-only">{labels.title}</DialogPrimitive.Title>

          {/* Image side — takes the majority of the width. */}
          <div className="relative flex h-[48dvh] w-full items-center justify-center bg-black md:h-full md:flex-1">
            <PhotoCarousel
              items={items}
              currentIndex={nav.currentIndex}
              windowIndices={nav.windowIndices}
              onPrevious={nav.previous}
              onNext={nav.next}
              isLoaded={isLoaded}
              markLoaded={markLoaded}
              className="h-full w-full"
            />
            {/* Share — top-left of the image; a translucent background appears on hover. */}
            <button
              type="button"
              onClick={handleShare}
              aria-label={labels.share}
              className="absolute top-3 left-3 z-20 flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
            >
              <Share2 className="h-[18px] w-[18px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
            </button>
            {/* Photo counter — top-right of the image. On mobile the image is
                full-width, so nudge it left of the close button; on desktop the
                close sits over the white panel, far from the image edge. */}
            {items.length > 1 ? (
              <div className="absolute top-3 right-14 z-20 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm md:right-3">
                {nav.currentIndex + 1} / {items.length}
              </div>
            ) : null}
          </div>

          {/* Info / CTA panel — narrow white column. */}
          <aside className="flex w-full shrink-0 flex-col bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-neutral-900 md:w-[300px]">
            <div className="flex-1 space-y-3 overflow-y-auto">
              {current.uploader?.name ? (
                <MetaRow icon={<Camera className="h-4 w-4" />}>{current.uploader.name}</MetaRow>
              ) : null}
              {current.location ? (
                <MetaRow icon={<MapPin className="h-4 w-4" />}>{current.location}</MetaRow>
              ) : null}
              {dateLabel ? (
                <MetaRow icon={<Calendar className="h-4 w-4" />}>{dateLabel}</MetaRow>
              ) : null}
              {dimensions ? (
                <MetaRow icon={<Maximize2 className="h-4 w-4" />}>{dimensions}</MetaRow>
              ) : null}
            </div>

            {/* Price + CTA pinned to the bottom (price directly above the button). */}
            <div className="mt-auto pt-4">
              {priceLabel ? (
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-sm text-neutral-500">{labels.pricePerPhoto}</span>
                  <span className="text-base font-bold text-neutral-900">{priceLabel}</span>
                </div>
              ) : null}
              {renderCta()}
            </div>
          </aside>

          {/* Close — top-right of the modal. White over the mobile image, dark
              over the desktop white panel. */}
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="absolute top-3 right-3 z-30 flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20 md:text-neutral-500 md:hover:bg-neutral-100"
          >
            <X className="h-[18px] w-[18px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] md:drop-shadow-none" />
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
