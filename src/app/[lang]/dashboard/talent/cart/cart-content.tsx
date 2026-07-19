'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShoppingCart, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CartItemRow } from '@/components/cart/cart-item-row';
import { CART_MERGE_STATE_KEY } from '@/components/guest-cart-merge';
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
import { cartView } from '@/lib/cart-view';
import { GUEST_CART_KEY } from '@/lib/guest-cart';
import { useTranslations } from '@/lib/i18n/translations-provider';
import {
  type CartData,
  type CartItemDetail,
  clearCartAction,
  createCheckoutSessionAction,
  getCurrentCart,
  removePhotoFromCartAction,
} from './actions';

interface CartContentProps {
  initialCartData: CartData;
}

export function CartContent({ initialCartData }: CartContentProps) {
  const [isPending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  // The cart item whose photo is open in the close-only lightbox (null = closed).
  const [lightboxItem, setLightboxItem] = useState<CartItemDetail | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  // If localStorage has guest cart items, signal the skeleton immediately —
  // before the SIGNED_IN event fires — so the user never sees the empty state.
  // useLayoutEffect runs synchronously before the browser paints, preventing
  // the empty-cart flash on the post-login redirect.
  useLayoutEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const stored = localStorage.getItem(GUEST_CART_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          queryClient.setQueryData(CART_MERGE_STATE_KEY, true);
          // Safety net: the skeleton now gates the whole cart (not just the
          // empty state), so a flag that never clears would hide real items.
          // GuestCartMerge clears it when the SIGNED_IN merge finishes; if that
          // never fires (e.g. already authenticated with stale guest items),
          // drop the flag after a few seconds so the cart still reveals.
          timeoutId = setTimeout(() => {
            queryClient.setQueryData(CART_MERGE_STATE_KEY, false);
          }, 6000);
        }
      }
    } catch {
      // ignore
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [queryClient]);

  // Cart items come from a client-side query so that invalidateQueries() after
  // merge/remove/clear can await the refetch — eliminating the race where the
  // skeleton cleared before the new data arrived.
  const { data: cartData = initialCartData } = useQuery({
    queryKey: ['cart-data'],
    queryFn: getCurrentCart,
    initialData: initialCartData,
    // Never auto-refetch; only re-fetch on explicit invalidation.
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Skeleton shown while merge is in progress (set by both useLayoutEffect above
  // and GuestCartMerge's onAuthStateChange handler).
  const { data: isMerging = false } = useQuery<boolean>({
    queryKey: CART_MERGE_STATE_KEY,
    queryFn: () => false,
    initialData: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // T-121: the page is `force-dynamic`, so `initialCartData` is a fresh server
  // snapshot on every navigation. But ['cart-data'] caches across navigations
  // with staleTime:Infinity, so a stale (e.g. empty, from a prior visit before
  // items were added) cache would shadow the fresh snapshot and the cart would
  // look empty until a manual refresh — even though the header badge, which
  // reads ['cart-count'], already updated. Seed the query with the fresh
  // snapshot on mount (before paint) so the page always reflects server truth
  // and shares one reactive source with the badge. This overwrites any stale
  // optimistic state on a fresh navigation, which is correct — the server is
  // authoritative on load.
  useLayoutEffect(() => {
    queryClient.setQueryData<CartData>(['cart-data'], initialCartData);
  }, [initialCartData, queryClient]);

  const lp = useLocalizedPath();
  const { t } = useTranslations<{
    empty: string;
    emptyCartAuthDesc: string;
    browseEvents: string;
    viewFavorites: string;
    item: string;
    items: string;
    clearCart: string;
    clearCartTitle: string;
    clearCartDesc: string;
    cancel: string;
    photoAlt: string;
    viewPhoto: string;
    viewEvent: string;
    viewPhotographer: string;
    free: string;
    remove: string;
    subtotal: string;
    allItemsFree: string;
    proceedToCheckout: string;
    processing: string;
    continueShopping: string;
    removedFromCart: string;
    failedRemoveItem: string;
    cartCleared: string;
    failedClearCart: string;
    failedStartCheckout: string;
    itemsUnavailableRemoved: string;
  }>();

  // T-117: getCurrentCart() self-heals cart_items whose photo has gone
  // unpurchasable (event soft-deleted, or upload_status no longer approved)
  // and reports how many via `removedCount`. Naturally one-shot: once
  // cleaned, the next fetch reports 0 unless something new goes bad.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire only when the fetched removedCount changes, not on every render (t() is a new closure each render)
  useEffect(() => {
    if (cartData.removedCount > 0) {
      toast(t('itemsUnavailableRemoved'));
    }
  }, [cartData.removedCount]);

  // T-121: optimistic remove. The item drops from the shared ['cart-data']
  // source and the badge (['cart-count']) decrements instantly — before the
  // server confirms — so the page and header never diverge. On failure we roll
  // back to the exact prior state and surface a toast.
  const handleRemove = (photoId: string) => {
    const previousData = queryClient.getQueryData<CartData>(['cart-data']) ?? cartData;
    const previousCount = queryClient.getQueryData<number>(['cart-count']);
    queryClient.setQueryData<CartData>(['cart-data'], (curr) => {
      const base = curr ?? previousData;
      const items = base.items.filter((i) => i.photoId !== photoId);
      return {
        ...base,
        items,
        itemCount: items.length,
        subtotalCents: items.reduce((sum, i) => sum + i.unitPriceCents, 0),
      };
    });
    queryClient.setQueryData<number>(['cart-count'], (n = 0) => Math.max(0, n - 1));
    setRemovingId(photoId);
    startTransition(async () => {
      try {
        await removePhotoFromCartAction(photoId);
        // Reconcile with server truth — covers the T-117 self-heal that may
        // have removed additional now-unpurchasable rows.
        await queryClient.invalidateQueries({ queryKey: ['cart-data'] });
        queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        toast.success(t('removedFromCart'));
      } catch (error) {
        // Exact rollback of both the list and the badge.
        queryClient.setQueryData<CartData>(['cart-data'], previousData);
        if (previousCount !== undefined) {
          queryClient.setQueryData<number>(['cart-count'], previousCount);
        } else {
          queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        }
        const message = error instanceof Error ? error.message : t('failedRemoveItem');
        toast.error(message);
      } finally {
        setRemovingId(null);
      }
    });
  };

  const handleClearCart = () => {
    const previousData = queryClient.getQueryData<CartData>(['cart-data']) ?? cartData;
    const previousCount = queryClient.getQueryData<number>(['cart-count']);
    queryClient.setQueryData<CartData>(['cart-data'], (curr) => ({
      ...(curr ?? previousData),
      items: [],
      itemCount: 0,
      subtotalCents: 0,
    }));
    queryClient.setQueryData<number>(['cart-count'], 0);
    startTransition(async () => {
      try {
        await clearCartAction();
        queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        toast.success(t('cartCleared'));
      } catch (error) {
        queryClient.setQueryData<CartData>(['cart-data'], previousData);
        if (previousCount !== undefined) {
          queryClient.setQueryData<number>(['cart-count'], previousCount);
        } else {
          queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        }
        const message = error instanceof Error ? error.message : t('failedClearCart');
        toast.error(message);
      }
    });
  };

  const handleCheckout = () => {
    if (cartData.items.length === 0) {
      toast.error(t('empty'));
      return;
    }

    setIsCheckingOut(true);
    startTransition(async () => {
      try {
        const { url } = await createCheckoutSessionAction();
        window.location.href = url;
      } catch (error) {
        const message = error instanceof Error ? error.message : t('failedStartCheckout');
        toast.error(message);
        setIsCheckingOut(false);
        // T-117: a rejection here may mean createCheckoutSessionAction just
        // self-healed the cart (deleted an unpurchasable row) — refetch so
        // the on-screen items/subtotal match what's actually in the DB,
        // instead of still showing the now-deleted item.
        queryClient.invalidateQueries({ queryKey: ['cart-data'] });
      }
    });
  };

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const view = cartView(isMerging, cartData.items.length);

  // While the guest→authenticated merge is in flight, show the skeleton for the
  // WHOLE cart — even when the authenticated cart already has items — so the
  // pre-merge items don't paint first and have the guest items pop in on top.
  // (T-039)
  if (view === 'merging') {
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

  if (view === 'empty') {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="relative mb-6">
          <ShoppingCart className="h-16 w-16 text-muted-foreground/50" />
          <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-muted flex items-center justify-center">
            <X className="h-3 w-3 text-muted-foreground" />
          </div>
        </div>
        <h3 className="text-2xl font-semibold mb-2">{t('empty')}</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">{t('emptyCartAuthDesc')}</p>
        <div className="flex gap-3">
          <Button onClick={() => router.push(lp('/dashboard/talent/events'))} variant="default">
            {t('browseEvents')}
          </Button>
          <Button onClick={() => router.push(lp('/dashboard/talent/favorites'))} variant="outline">
            {t('viewFavorites')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex flex-col md:flex-row gap-6 pb-44 md:pb-0">
        {/* Left side - Cart items */}
        <div className="flex-2 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted-foreground mt-1">
              {cartData.itemCount} {cartData.itemCount === 1 ? t('item') : t('items')}
            </p>
            {cartData.items.length > 0 && (
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
                    <AlertDialogAction onClick={handleClearCart}>
                      {t('clearCart')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <div className="space-y-3">
            {cartData.items.map((item) => (
              <CartItemRow
                key={item.photoId}
                previewUrl={item.previewUrl}
                eventName={item.eventTitle}
                eventShareCode={item.eventShareCode}
                eventDate={item.eventDate}
                photographerName={item.photographerName}
                photographerSlug={item.photographerSlug}
                unitPriceCents={item.unitPriceCents}
                removing={isPending && removingId === item.photoId}
                onViewPhoto={() => setLightboxItem(item)}
                onRemove={() => handleRemove(item.photoId)}
                labels={{
                  photoAlt: t('photoAlt'),
                  viewPhoto: t('viewPhoto'),
                  viewEvent: t('viewEvent'),
                  viewPhotographer: t('viewPhotographer'),
                  remove: t('remove'),
                  free: t('free'),
                }}
              />
            ))}
          </div>
        </div>

        {/* Right side - Summary (desktop only). `md:mt-10` drops the summary by
            the height of the left column's "N items / Clear cart" header row
            (h-8 button + mb-2 = 40px) so its top lines up with the first cart
            item instead of the header row. */}
        <div className="hidden min-w-0 flex-1 md:mt-10 md:block">
          <div className="sticky top-[calc(var(--header-height)+1rem)] self-start rounded-lg border border-border bg-card p-6 shadow-lg">
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">{t('subtotal')}</span>
                  <span className="text-xl font-bold text-foreground">
                    {formatPrice(cartData.subtotalCents)}
                  </span>
                </div>
                {cartData.subtotalCents === 0 && (
                  <p className="text-xs text-muted-foreground text-center">{t('allItemsFree')}</p>
                )}
              </div>

              <div className="pt-4 border-t border-border">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleCheckout}
                  disabled={cartData.items.length === 0 || isCheckingOut}
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

      {/* Mobile summary - sticky footer (stacked above BottomNav) */}
      <div className="md:hidden fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 border-t border-border bg-card shadow-lg">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">{t('subtotal')}</span>
            <span className="text-lg font-bold text-foreground">
              {formatPrice(cartData.subtotalCents)}
            </span>
          </div>
          <Button
            className="w-full"
            size="sm"
            onClick={handleCheckout}
            disabled={cartData.items.length === 0 || isCheckingOut}
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
      {lightboxItem?.previewUrl && (
        <PhotoLightbox
          items={[
            {
              id: lightboxItem.photoId,
              url: lightboxItem.previewUrl,
              alt: lightboxItem.eventTitle ?? t('photoAlt'),
            },
          ]}
          open={lightboxItem !== null}
          onClose={() => setLightboxItem(null)}
        />
      )}
    </div>
  );
}
