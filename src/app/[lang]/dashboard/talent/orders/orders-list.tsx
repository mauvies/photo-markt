'use client';

import { format } from 'date-fns';
import { ChevronDown, Image as ImageIcon, ImageOff, ShoppingBag } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import type { OrderWithItemCount } from './actions';

type OrdersListT = Dictionary['ordersList'];

function formatCurrency(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/**
 * Status-to-badge mapping with semantic colors. Using `variant` for built-in
 * tokens (default / secondary / destructive / outline) keeps the badge in step
 * with the rest of the app's color system; the one exception is the
 * green-tinted "completed" badge which doesn't have a built-in equivalent.
 */
function StatusBadge({ status, t }: { status: string; t: (k: keyof OrdersListT) => string }) {
  switch (status) {
    case 'completed':
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-300">
          {t('completed')}
        </Badge>
      );
    case 'pending':
    case 'processing':
      return (
        <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:bg-amber-500/20 dark:text-amber-300">
          {status === 'pending' ? t('pending') : t('processing')}
        </Badge>
      );
    case 'failed':
    case 'canceled':
      return (
        <Badge variant="destructive">{status === 'failed' ? t('failed') : t('canceled')}</Badge>
      );
    case 'refunded':
      return <Badge variant="outline">{t('refunded')}</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

/**
 * Renders a single thumbnail slot: the photo when its signed URL loads, or an
 * icon fallback (T-116) when the slot has no photo at all (its row was
 * deleted server-side — `url === null`) or the image fails to load client-side
 * (the row survives but the storage object is gone — a 404 on a validly
 * signed URL, since Supabase signs URLs without checking object existence).
 * Both converge on the same "photo no longer available" fallback — we can't
 * reliably tell a real 404 apart from a transient network error, but a broken
 * `<img>` icon or blank slot is never acceptable either way.
 */
function OrderThumbnailTile({
  url,
  unavailableLabel,
  showLabel,
}: {
  url: string | null;
  unavailableLabel: string;
  showLabel: boolean;
}) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (url === null || loadFailed) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground"
        title={unavailableLabel}
      >
        <ImageOff className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        {showLabel && (
          <span className="px-1 text-center text-[9px] leading-tight">{unavailableLabel}</span>
        )}
        <span className="sr-only">{unavailableLabel}</span>
      </div>
    );
  }

  return (
    <Image
      src={url}
      alt=""
      fill
      sizes="40px"
      className="object-cover"
      // Watermark API serves these — its own cache headers handle TTL.
      unoptimized
      onError={() => setLoadFailed(true)}
    />
  );
}

function ThumbnailStack({
  thumbnails,
  itemCount,
  unavailableLabel,
}: {
  thumbnails: (string | null)[];
  itemCount: number;
  unavailableLabel: string;
}) {
  // Fall back to a neutral placeholder block when there's no preview to show
  // (e.g. failed orders never produced order_items, or signed URLs all
  // expired/errored). Keeps the card layout consistent.
  if (thumbnails.length === 0) {
    return (
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border bg-muted">
        <ImageIcon className="h-6 w-6 text-muted-foreground/50" aria-hidden />
      </div>
    );
  }

  const overflow = itemCount - thumbnails.length;
  return (
    <div className="grid h-20 w-20 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-lg border">
      {thumbnails.slice(0, 4).map((url, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: url is the key; the index only disambiguates duplicate/null urls in this fixed-order, display-only list
        <div key={`${url ?? 'unavailable'}-${i}`} className="relative bg-muted">
          <OrderThumbnailTile url={url} unavailableLabel={unavailableLabel} showLabel={false} />
          {/* Overflow chip sits on the last tile when there are more photos
              than thumbnails fetched. */}
          {i === 3 && overflow > 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] font-semibold text-white">
              +{overflow}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function OrderCard({
  order,
  t,
}: {
  order: OrderWithItemCount;
  t: (k: keyof OrdersListT) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasExtras = order.thumbnails.length > 0;
  const orderDate = format(new Date(order.created_at), 'MMM d, yyyy');
  const photoLabel = order.item_count === 1 ? t('photo') : t('photos');
  const unavailableLabel = t('photoNoLongerAvailable');

  return (
    <Card className="overflow-hidden p-0 transition-colors hover:bg-accent/30">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <ThumbnailStack
          thumbnails={order.thumbnails}
          itemCount={order.item_count}
          unavailableLabel={unavailableLabel}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-semibold tracking-tight">{orderDate}</span>
            <StatusBadge status={order.status} t={t} />
          </div>
          <div className="text-sm text-muted-foreground">
            {order.item_count} {photoLabel} ·{' '}
            <span className="font-medium text-foreground">
              {formatCurrency(order.total_amount_cents, order.currency)}
            </span>
          </div>
          <div className="font-mono text-xs text-muted-foreground/70">
            {t('orderShort')} #{order.id.slice(0, 8)}
          </div>
        </div>

        {hasExtras && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="w-full justify-center gap-1.5 sm:w-auto"
          >
            {expanded ? t('hideDetails') : t('viewDetails')}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')}
              aria-hidden
            />
          </Button>
        )}
      </CardContent>

      {/* Expandable detail strip — shows every fetched thumbnail at a readable
          size. Capped at 4 today by the action; the overflow indicator on the
          stacked preview communicates the rest. */}
      {expanded && hasExtras && (
        <div className="border-t bg-muted/30 px-4 py-4 sm:px-5">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {order.thumbnails.map((url, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: url is the key; the index only disambiguates duplicate/null urls in this fixed-order, display-only list
                key={`${url ?? 'unavailable'}-${i}`}
                className="relative aspect-square overflow-hidden rounded-md border bg-muted"
              >
                <OrderThumbnailTile url={url} unavailableLabel={unavailableLabel} showLabel />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function EmptyState({ t }: { t: (k: keyof OrdersListT) => string }) {
  const lp = useLocalizedPath();
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <ShoppingBag className="h-7 w-7 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold tracking-tight">{t('noOrdersYet')}</h3>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{t('noOrdersDesc')}</p>
        </div>
        <Link href={lp('/dashboard/talent/events')}>
          <Button>{t('exploreEvents')}</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export function OrdersList({ orders }: { orders: OrderWithItemCount[] }) {
  const { t } = useTranslations<OrdersListT>();

  if (orders.length === 0) {
    return <EmptyState t={t} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} t={t} />
      ))}
    </div>
  );
}
