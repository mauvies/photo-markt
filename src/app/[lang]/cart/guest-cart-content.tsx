'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShoppingCart, Trash2, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  createGuestCheckoutSessionAction,
  loadGuestCartStateAction,
} from '@/app/[lang]/cart/actions';
import { CartItemRow } from '@/components/cart/cart-item-row';
import { CartTotals } from '@/components/cart-totals';
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
import { checkoutErrorMessageKey } from '@/lib/checkout-error';
import type { GuestCartItem } from '@/lib/guest-cart';
import { useTranslations } from '@/lib/i18n/translations-provider';

export function GuestCartContent() {
  const { items, removeItem, clearCart, subtotalCents, hydrated } = useGuestCart();
  const router = useRouter();
  const queryClient = useQueryClient();
  const photoIds = useMemo(() => items.map((item) => item.photoId), [items]);
  const photographerIds = useMemo(
    () => Array.from(new Set(items.map((item) => item.photographerId))).sort(),
    [items],
  );
  // Per-item share codes prove access to private events (T-132) — a guest item
  // stashed its event's code at add time. Deduped + sorted so the query key is
  // stable regardless of item order.
  const shareCodes = useMemo(
    () =>
      Array.from(
        new Set(items.map((item) => item.eventShareCode).filter((c): c is string => Boolean(c))),
      ).sort(),
    [items],
  );
  // Live preview lookup (T-115) + purchasability validation (T-117) in one
  // round trip — never render the `previewUrl` snapshot stashed in
  // localStorage at add-to-cart time (a signed original that expires after
  // ~1h), and never keep an entry whose photo is no longer purchasable
  // (deleted, event soft-deleted, or no longer approved).
  const { data: guestCartState } = useQuery({
    queryKey: ['guest-cart-state', photoIds, shareCodes, photographerIds],
    queryFn: () => loadGuestCartStateAction(photoIds, shareCodes, photographerIds),
    enabled: photoIds.length > 0,
  });
  const livePreviews = guestCartState?.previews;
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
    serviceFee: string;
    total: string;
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
    viewPhotographer: string;
    itemsUnavailableRemoved: string;
    checkoutPhotographerNotConnected: string;
    checkoutRateLimited: string;
  }>();

  // Drop unpurchasable entries and notify (T-117) — naturally one-shot: once
  // removed, the next validation (with the now-smaller id list) reports
  // nothing left to remove.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire only when the fetched removed-id set changes, not on every render
  useEffect(() => {
    const removedIds = guestCartState?.removedPhotoIds;
    if (!removedIds || removedIds.length === 0) return;
    for (const id of removedIds) removeItem(id);
    toast(t('itemsUnavailableRemoved'));
  }, [guestCartState?.removedPhotoIds]);

  const handleCheckout = () => {
    setIsCheckingOut(true);
    startTransition(async () => {
      try {
        const res = await createGuestCheckoutSessionAction(items);
        // T-189: expected, user-facing failures come back as a typed code
        // (Next redacts thrown Server Action messages in prod), so the buyer
        // sees the localized reason — e.g. a photographer not payout-ready.
        if (!res.ok) {
          toast.error(t(checkoutErrorMessageKey(res.error)));
          setIsCheckingOut(false);
          // T-117: only `items_unavailable` means an item just became
          // unpurchasable — re-validate so the self-heal effect above drops it
          // and notifies, instead of the user retrying the same failing
          // checkout. The other codes leave the cart valid, so no refetch.
          if (res.error === 'items_unavailable') {
            queryClient.invalidateQueries({ queryKey: ['guest-cart-state'] });
          }
          return;
        }
        window.location.href = res.url;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('checkoutFailed'));
        setIsCheckingOut(false);
        queryClient.invalidateQueries({ queryKey: ['guest-cart-state'] });
      }
    });
  };

  const totalsLabels = {
    subtotal: t('subtotal'),
    serviceFee: t('serviceFee'),
    total: t('total'),
    free: t('free'),
  };

  // The guest cart lives in localStorage and is read on mount, so `items` is
  // empty on the first client render regardless of whether the cart truly is.
  // Show a skeleton until hydration completes — never the empty state — so a
  // populated cart doesn't flash "empty" before its items paint (T-176). Only
  // after hydration is `items.length === 0` a genuine empty cart.
  if (!hydrated) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 rounded-lg border border-border bg-card p-3">
            <Skeleton className="h-24 w-24 shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2 justify-between py-1">
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

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
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border bg-primary/5 px-4 py-4 text-sm">
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
            const photographer = guestCartState?.photographers?.[item.photographerId];
            return (
              <CartItemRow
                key={item.photoId}
                previewUrl={livePreviews?.[item.photoId]}
                previewLoading={livePreviews === undefined}
                eventName={item.eventName}
                eventShareCode={item.eventShareCode}
                eventDate={item.eventDate}
                photographerName={photographer?.name}
                photographerSlug={photographer?.slug}
                unitPriceCents={item.unitPriceCents}
                onViewPhoto={() => setLightboxItem(item)}
                onRemove={() => removeItem(item.photoId)}
                labels={{
                  photoAlt: t('photoAlt'),
                  viewPhoto: t('viewPhoto'),
                  viewEvent: t('viewEvent'),
                  viewPhotographer: t('viewPhotographer'),
                  remove: t('remove'),
                  free: t('free'),
                }}
              />
            );
          })}
        </div>

        {/* Right — summary sticky (desktop) */}
        <div className="hidden md:block flex-1 min-w-0">
          <div className="sticky top-[calc(var(--header-height)+1rem)] self-start rounded-lg border border-border bg-card p-6 shadow-lg">
            <div className="space-y-4">
              <CartTotals subtotalCents={subtotalCents} labels={totalsLabels} />
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
          <div className="mb-3">
            <CartTotals subtotalCents={subtotalCents} labels={totalsLabels} variant="mobile" />
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
