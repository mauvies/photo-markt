'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Calendar,
  Image as ImageIcon,
  Loader2,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  createGuestCheckoutSessionAction,
  resolveGuestCartPreviewsAction,
} from '@/app/[lang]/cart/actions';
import { useGuestCart } from '@/components/guest-cart-provider';
import { PhotoLightbox } from '@/components/photo-lightbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { useLoginHref, useSignupHref } from '@/hooks/use-login-href';
import type { GuestCartItem } from '@/lib/guest-cart';
import { useTranslations } from '@/lib/i18n/translations-provider';

export function GuestCartContent() {
  const { items, removeItem, clearCart, subtotalCents } = useGuestCart();
  const router = useRouter();
  const photoIds = useMemo(() => items.map((item) => item.photoId), [items]);
  // Live preview lookup (T-115) — never render the `previewUrl` snapshot
  // stashed in localStorage at add-to-cart time; it's a signed original that
  // expires after ~1h. Resolved fresh on every cart load instead.
  const { data: livePreviews } = useQuery({
    queryKey: ['guest-cart-previews', photoIds],
    queryFn: () => resolveGuestCartPreviewsAction(photoIds),
    enabled: photoIds.length > 0,
  });
  const lp = useLocalizedPath();
  const buildLoginHref = useLoginHref();
  const buildSignupHref = useSignupHref();
  const searchParams = useSearchParams();
  const canceled = searchParams.get('canceled') === 'true';
  const [isPending, startTransition] = useTransition();
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  // The guest cart item whose photo is open in the close-only lightbox.
  const [lightboxItem, setLightboxItem] = useState<GuestCartItem | null>(null);
  const { t } = useTranslations<{
    browseEventsDesc: string;
    signInNudgeTitle: string;
    signInNudgeDesc: string;
    logIn: string;
    signUpFree: string;
    item: string;
    items: string;
    clearCart: string;
    clearCartTitle: string;
    clearCartDesc: string;
    cancel: string;
    checkoutCanceled: string;
    subtotal: string;
    emailNotice: string;
    proceedToCheckout: string;
    processing: string;
    continueShopping: string;
    remove: string;
    free: string;
    checkoutFailed: string;
    empty: string;
    browseEvents: string;
    photoAlt: string;
    viewPhoto: string;
    viewEvent: string;
  }>();

  const handleCheckout = () => {
    setIsCheckingOut(true);
    startTransition(async () => {
      try {
        const { url } = await createGuestCheckoutSessionAction(items);
        window.location.href = url;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('checkoutFailed'));
        setIsCheckingOut(false);
      }
    });
  };

  const formatPrice = (cents: number) => (cents === 0 ? t('free') : `$${(cents / 100).toFixed(2)}`);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="relative mb-6">
          <ShoppingCart className="h-16 w-16 text-muted-foreground/50" />
          <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-muted flex items-center justify-center">
            <X className="h-3 w-3 text-muted-foreground" />
          </div>
        </div>
        <h3 className="text-2xl font-semibold mb-2">{t('empty')}</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">{t('browseEventsDesc')}</p>
        <Button onClick={() => router.push(lp('/events'))}>{t('browseEvents')}</Button>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Sign-in nudge */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border bg-primary/5 px-4 py-3 text-sm">
        <div className="flex items-start gap-2">
          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium">{t('signInNudgeTitle')}</p>
            <p className="text-muted-foreground">{t('signInNudgeDesc')}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 sm:ml-auto">
          <Link href={buildLoginHref()}>
            <Button variant="outline" size="sm">
              {t('logIn')}
            </Button>
          </Link>
          <Link href={buildSignupHref()}>
            <Button size="sm">{t('signUpFree')}</Button>
          </Link>
        </div>
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? t('item') : t('items')}
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <Trash2 className="h-4 w-4 mr-2" />
              {t('clearCart')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('clearCartTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('clearCartDesc')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={clearCart}>{t('clearCart')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {canceled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {t('checkoutCanceled')}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6 pb-20 md:pb-0">
        {/* Left — cart items */}
        <div className="flex-2 min-w-0 space-y-3">
          {items.map((item) => {
            const livePreviewUrl = livePreviews?.[item.photoId];
            const previewsPending = livePreviews === undefined;
            return (
              <div
                key={item.photoId}
                className="group flex gap-4 rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-md"
              >
                {livePreviewUrl ? (
                  <button
                    type="button"
                    onClick={() => setLightboxItem(item)}
                    aria-label={t('viewPhoto')}
                    className="relative h-32 w-32 shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-muted"
                  >
                    <Image
                      src={livePreviewUrl}
                      alt={item.eventName ?? t('photoAlt')}
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                      sizes="128px"
                      unoptimized
                    />
                  </button>
                ) : previewsPending ? (
                  <Skeleton className="h-32 w-32 shrink-0 rounded-lg" />
                ) : (
                  <div className="relative flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}

                <div className="flex flex-1 flex-col gap-2 min-w-0">
                  <div>
                    {item.eventName &&
                      (item.eventShareCode ? (
                        <Link
                          href={lp(`/events/${item.eventShareCode}`)}
                          title={t('viewEvent')}
                          className="font-semibold text-base text-foreground line-clamp-1 hover:underline"
                        >
                          {item.eventName}
                        </Link>
                      ) : (
                        <h4 className="font-semibold text-base text-foreground line-clamp-1">
                          {item.eventName}
                        </h4>
                      ))}
                    {item.eventDate && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>{format(new Date(item.eventDate), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-4">
                    <span className="text-xl font-bold text-foreground">
                      {formatPrice(item.unitPriceCents)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(item.photoId)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      <span className="hidden sm:inline">{t('remove')}</span>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right — summary sticky (desktop) */}
        <div className="hidden md:block flex-1 min-w-0">
          <div className="sticky top-4 self-start rounded-lg border border-border bg-card p-6 shadow-lg">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{t('subtotal')}</span>
                <span className="text-xl font-bold text-foreground">
                  {formatPrice(subtotalCents)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t('emailNotice')}</p>
              <div className="pt-4 border-t border-border">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleCheckout}
                  disabled={isPending || isCheckingOut}
                >
                  {isCheckingOut ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('processing')}
                    </>
                  ) : (
                    t('proceedToCheckout')
                  )}
                </Button>
                <p className="text-xs text-center text-muted-foreground mt-3">
                  {t('continueShopping')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky footer */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card shadow-lg">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">{t('subtotal')}</span>
            <span className="text-lg font-bold text-foreground">{formatPrice(subtotalCents)}</span>
          </div>
          <Button
            className="w-full"
            size="sm"
            onClick={handleCheckout}
            disabled={isPending || isCheckingOut}
          >
            {isCheckingOut ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('processing')}
              </>
            ) : (
              t('proceedToCheckout')
            )}
          </Button>
        </div>
      </div>

      {/* Close-only lightbox: a bigger look at the cart photo, no actions. */}
      {lightboxItem && livePreviews?.[lightboxItem.photoId] && (
        <PhotoLightbox
          items={[
            {
              id: lightboxItem.photoId,
              url: livePreviews[lightboxItem.photoId] as string,
              alt: lightboxItem.eventName ?? t('photoAlt'),
            },
          ]}
          open={lightboxItem !== null}
          onClose={() => setLightboxItem(null)}
        />
      )}
    </div>
  );
}
