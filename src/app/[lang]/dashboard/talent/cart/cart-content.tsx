'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShoppingCart, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
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
import { checkoutErrorMessageKey } from '@/lib/checkout-error';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
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
  // How many optimistic removals are still awaiting their server confirmation
  // (T-162). Gates both the server-truth reconcile below and the fresh-snapshot
  // re-seed so a delete committing mid-sequence can't resurrect a sibling that
  // was removed later.
  const pendingRemovalsRef = useRef(0);

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
  //
  // T-162: but NOT while removals are still in flight. A Server Action refresh
  // triggered by one delete completing re-renders this route and hands down a
  // new `initialCartData` snapshot — one that may have been captured before a
  // sibling delete committed. Re-seeding from it mid-sequence would resurrect
  // the later-removed item. Skip the re-seed until every removal has settled;
  // the reconcile in `handleRemove` then pulls the consistent server state.
  useLayoutEffect(() => {
    if (pendingRemovalsRef.current > 0) return;
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
    checkoutPhotographerNotConnected: string;
    checkoutRateLimited: string;
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

  // T-121/T-162: optimistic remove. The item drops from the shared ['cart-data']
  // source and the badge (['cart-count']) decrements instantly — before the
  // server confirms — so the page and header never diverge.
  //
  // T-162 (deletes that reappear): removing several items in quick succession
  // used to race. Each removal awaited its own `invalidateQueries` refetch of
  // getCurrentCart; a refetch fired by an EARLIER delete could resolve while a
  // LATER delete's DELETE hadn't committed, returning a server snapshot that
  // still held the later item and overwriting the optimistic state that had
  // already dropped it → it reappeared. Two guards close that:
  //  1. `cancelQueries` before mutating aborts any in-flight reconcile so a
  //     stale snapshot can't land on top of a newer removal; and
  //  2. the reconcile refetch runs ONLY once every pending removal has settled
  //     (`pendingRemovalsRef` back to 0), so it reads a consistent server state
  //     with all deletes committed — never a mid-sequence one.
  // On failure we re-insert ONLY the failed item (not a full snapshot, which
  // would also resurrect siblings a concurrent removal legitimately dropped).
  const handleRemove = (photoId: string) => {
    const base = queryClient.getQueryData<CartData>(['cart-data']) ?? cartData;
    const removedItem = base.items.find((i) => i.photoId === photoId);

    pendingRemovalsRef.current += 1;
    // Abort any reconcile refetch in flight so it can't overwrite this removal.
    // Cancel BOTH the cart list and the nav count (T-165): the count query
    // (['cart-count'], read by the persistent nav) is fed by an absolute
    // getCartItemCount SELECT; a stale in-flight count refetch left running
    // could resolve late with a partially-committed count and overwrite the
    // optimistic 0, leaving the nav cart button stuck on a phantom number.
    queryClient.cancelQueries({ queryKey: ['cart-data'] });
    queryClient.cancelQueries({ queryKey: ['cart-count'] });
    queryClient.setQueryData<CartData>(['cart-data'], (curr) => {
      const current = curr ?? base;
      const items = current.items.filter((i) => i.photoId !== photoId);
      return {
        ...current,
        items,
        itemCount: items.length,
        subtotalCents: items.reduce((sum, i) => sum + i.unitPriceCents, 0),
      };
    });
    queryClient.setQueryData<number>(['cart-count'], (n = 0) => Math.max(0, n - 1));
    setRemovingId(photoId);
    startTransition(async () => {
      let succeeded = false;
      try {
        await removePhotoFromCartAction(photoId);
        succeeded = true;
        // Success is silent (T-163): the optimistic UI already removed the item,
        // so a success toast is redundant noise. Only failure notifies.
      } catch (error) {
        // Targeted rollback: re-insert just the failed item and bump the badge
        // back by one — never restore a whole snapshot.
        if (removedItem) {
          queryClient.setQueryData<CartData>(['cart-data'], (curr) => {
            const current = curr ?? base;
            if (current.items.some((i) => i.photoId === photoId)) return current;
            const items = [...current.items, removedItem];
            return {
              ...current,
              items,
              itemCount: items.length,
              subtotalCents: items.reduce((sum, i) => sum + i.unitPriceCents, 0),
            };
          });
        }
        queryClient.setQueryData<number>(['cart-count'], (n = 0) => n + 1);
        const message = error instanceof Error ? error.message : t('failedRemoveItem');
        toast.error(message);
      } finally {
        pendingRemovalsRef.current = Math.max(0, pendingRemovalsRef.current - 1);
        // Reconcile with server truth only once ALL removals have settled — this
        // covers the T-117 self-heal (rows removed for going unpurchasable)
        // without a mid-sequence snapshot resurrecting a just-removed item. Skip
        // when the last to settle failed: the targeted rollback already reflects
        // reality and a refetch adds nothing.
        if (succeeded && pendingRemovalsRef.current === 0) {
          await queryClient.invalidateQueries({ queryKey: ['cart-data'] });
          // Derive the nav count from the reconciled cart list — the single
          // source of truth — instead of a separate absolute getCartItemCount
          // refetch that could observe a mid-sequence, partially-committed
          // delete set and clobber the optimistic 0 (T-165). The cart-data
          // reconcile above is already gated (all removals settled) and
          // cancel-guarded, so its itemCount is authoritative.
          const reconciled = queryClient.getQueryData<CartData>(['cart-data']);
          if (reconciled) {
            queryClient.setQueryData<number>(['cart-count'], reconciled.itemCount);
          }
        }
        setRemovingId(null);
      }
    });
  };

  const handleClearCart = () => {
    const previousData = queryClient.getQueryData<CartData>(['cart-data']) ?? cartData;
    const previousCount = queryClient.getQueryData<number>(['cart-count']);
    // Abort any in-flight count refetch so it can't resolve late over the 0 (T-165).
    queryClient.cancelQueries({ queryKey: ['cart-data'] });
    queryClient.cancelQueries({ queryKey: ['cart-count'] });
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
        // The cart is empty after a successful clear — the optimistic 0 is
        // authoritative. Set it directly rather than an absolute getCartItemCount
        // refetch that could race a concurrent count fetch (T-165).
        queryClient.setQueryData<number>(['cart-count'], 0);
        // Success is silent (T-163) — the optimistic clear is the only feedback.
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
        const res = await createCheckoutSessionAction();
        // T-189: expected, user-facing failures come back as a typed code
        // (Next redacts thrown Server Action messages in prod), so the buyer
        // sees the localized reason — e.g. a photographer not payout-ready.
        if (!res.ok) {
          toast.error(t(checkoutErrorMessageKey(res.error)));
          setIsCheckingOut(false);
          // T-117: only `items_unavailable` means the action mutated the cart
          // (it self-heals by deleting the now-unpurchasable row) — refetch so
          // the on-screen items/subtotal match the DB. The other codes leave
          // the cart untouched, so a refetch would be a needless round-trip.
          if (res.error === 'items_unavailable') {
            queryClient.invalidateQueries({ queryKey: ['cart-data'] });
          }
          return;
        }
        window.location.href = res.url;
      } catch (error) {
        const message = error instanceof Error ? error.message : t('failedStartCheckout');
        toast.error(message);
        setIsCheckingOut(false);
        queryClient.invalidateQueries({ queryKey: ['cart-data'] });
      }
    });
  };

  const formatPrice = (cents: number) => `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;

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
