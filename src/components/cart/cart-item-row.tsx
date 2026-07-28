'use client';

import { format } from 'date-fns';
import { Calendar, Camera, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';

export interface CartItemRowLabels {
  photoAlt: string;
  viewPhoto: string;
  viewEvent: string;
  viewPhotographer: string;
  remove: string;
  free: string;
}

export interface CartItemRowProps {
  /** Live preview URL (watermarked/protected). `null`/`undefined` → placeholder. */
  previewUrl?: string | null;
  /** Guest cart only: the live preview lookup is still in flight → skeleton. */
  previewLoading?: boolean;
  eventName?: string | null;
  eventShareCode?: string | null;
  /** ISO date string. */
  eventDate?: string | null;
  photographerName?: string | null;
  photographerSlug?: string | null;
  unitPriceCents: number;
  /** Authenticated cart: a remove is in flight → spinner instead of the icon. */
  removing?: boolean;
  onViewPhoto: () => void;
  onRemove: () => void;
  labels: CartItemRowLabels;
}

/**
 * One cart line item — shared by the guest (`/cart`) and authenticated
 * (`/dashboard/talent/cart`) cart pages so the two never drift in styling. The
 * genuinely per-flow differences are props: `previewLoading` (guest live
 * preview), `removing` (auth optimistic remove spinner), and the photographer
 * link (resolved differently per flow, but passed here as name + slug).
 */
export function CartItemRow({
  previewUrl,
  previewLoading = false,
  eventName,
  eventShareCode,
  eventDate,
  photographerName,
  photographerSlug,
  unitPriceCents,
  removing = false,
  onViewPhoto,
  onRemove,
  labels,
}: CartItemRowProps) {
  const lp = useLocalizedPath();
  const formatPrice = (cents: number) => `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;

  return (
    <div className="group flex gap-4 rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-md">
      {previewUrl ? (
        <button
          type="button"
          onClick={onViewPhoto}
          aria-label={labels.viewPhoto}
          className="relative w-28 shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-muted"
        >
          <Image
            src={previewUrl}
            alt={eventName ?? labels.photoAlt}
            fill
            className="object-cover transition-transform group-hover:scale-105"
            sizes="96px"
            // The preview is a protected/signed image; routing a large original
            // through the Vercel optimizer times out (T-110/T-111). Serve direct.
            unoptimized
          />
        </button>
      ) : previewLoading ? (
        <Skeleton className="h-24 w-24 shrink-0 rounded-lg" />
      ) : (
        <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
          <ImageIcon className="h-8 w-8" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          {eventName &&
            (eventShareCode ? (
              <Link
                href={lp(`/events/${eventShareCode}`)}
                title={labels.viewEvent}
                className="line-clamp-1 text-base font-semibold text-foreground hover:underline"
              >
                {eventName}
              </Link>
            ) : (
              <h4 className="line-clamp-1 text-base font-semibold text-foreground">{eventName}</h4>
            ))}
          <div className="flex flex-col items-start gap-1 text-sm text-muted-foreground">
            {photographerName &&
              (photographerSlug ? (
                <Link
                  href={lp(`/photographer/${photographerSlug}`)}
                  title={labels.viewPhotographer}
                  className="flex items-center gap-1.5 hover:underline"
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span className="line-clamp-1">{photographerName}</span>
                </Link>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Camera className="h-3.5 w-3.5" />
                  <span className="line-clamp-1">{photographerName}</span>
                </div>
              ))}
            {eventDate && (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                <span>{format(new Date(eventDate), 'MMM d, yyyy')}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-4">
          {unitPriceCents === 0 ? (
            <span className="text-xl font-bold text-green-600 dark:text-green-400">
              {labels.free}
            </span>
          ) : (
            <span className="text-xl font-bold text-foreground">{formatPrice(unitPriceCents)}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={removing}
            className="shrink-0 text-foreground/90 hover:bg-muted hover:text-foreground"
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">{labels.remove}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
