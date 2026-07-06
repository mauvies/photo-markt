'use client';

import { Download, Share2, X } from 'lucide-react';
import { PhotoCarousel } from '@/components/photo-carousel';
import type { PhotoUploaderInfo } from '@/components/photo-uploader-indicator';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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

/**
 * Two-panel, conversion-focused photo detail for PAID purchase surfaces
 * (public + talent event views, AI search results). The image (shared
 * `PhotoCarousel`) sits on the left; a white info/CTA panel on the right shows
 * attribution, location, date, dimensions, price, and a large primary button.
 * Free events keep the lightbox — see `PhotoAlbumViewer`'s `detailVariant`.
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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[90dvh] max-h-[90dvh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden rounded-xl p-0 md:flex-row"
      >
        <DialogTitle className="sr-only">{labels.title}</DialogTitle>

        {/* Image side */}
        <div className="relative flex h-[42dvh] w-full items-center justify-center bg-black md:h-full md:flex-1">
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
          {/* Share — top-right of the image on desktop, top-left on mobile so it
              never collides with the counter/close cluster. */}
          <button
            type="button"
            onClick={handleShare}
            aria-label={labels.share}
            className="absolute top-3 left-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 md:left-auto md:right-3"
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>

        {/* Info / CTA panel */}
        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-neutral-900 md:w-80 dark:bg-white">
          {current.uploader?.name ? (
            <p className="text-base font-semibold">{current.uploader.name}</p>
          ) : null}
          <div className="flex flex-col gap-1 text-sm text-neutral-600">
            {current.location ? <span>{current.location}</span> : null}
            {dateLabel ? <span>{dateLabel}</span> : null}
            {dimensions ? <span>{dimensions}</span> : null}
          </div>

          {priceLabel ? (
            <div className="mt-1">
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                {labels.pricePerPhoto}
              </p>
              <p className="text-lg font-semibold">{priceLabel}</p>
            </div>
          ) : null}

          <div className="mt-auto pt-3">{renderCta()}</div>
        </aside>

        {/* Top-right cluster: counter + close */}
        <div className="absolute right-3 top-3 z-30 flex items-center gap-2">
          {items.length > 1 ? (
            <span className="rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {nav.currentIndex + 1} / {items.length}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
