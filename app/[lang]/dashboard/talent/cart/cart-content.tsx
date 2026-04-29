'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Calendar, Image as ImageIcon, Loader2, ShoppingCart, Trash2, User, X } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CART_MERGE_STATE_KEY } from '@/components/guest-cart-merge';
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
import { useTranslations } from '@/lib/i18n/translations-provider';
import {
  type CartData,
  clearCartAction,
  createCheckoutSessionAction,
  getCurrentCart,
  removePhotoFromCartAction,
} from './actions';

interface CartContentProps {
  initialCartData: CartData;
}

export function CartContent({ initialCartData }: CartContentProps) {
  const [cartData, setCartData] = useState(initialCartData);
  const [isPending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Sync server-rendered cart data when router.refresh() delivers a new RSC payload
  useEffect(() => {
    setCartData(initialCartData);
  }, [initialCartData]);

  // Show skeleton while guest cart merge is writing to the DB
  const { data: isMerging = false } = useQuery<boolean>({
    queryKey: CART_MERGE_STATE_KEY,
    queryFn: () => false,
    initialData: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const lp = useLocalizedPath();
  const { t } = useTranslations<{
    empty: string;
    emptyCartAuthDesc: string;
    browseEvents: string;
    viewMyPhotos: string;
    item: string;
    items: string;
    clearCart: string;
    clearCartTitle: string;
    clearCartDesc: string;
    cancel: string;
    photoAlt: string;
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
  }>();

  const handleRemove = (photoId: string) => {
    setRemovingId(photoId);
    startTransition(async () => {
      try {
        await removePhotoFromCartAction(photoId);
        const updated = await getCurrentCart();
        setCartData(updated);
        queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        toast.success(t('removedFromCart'));
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : t('failedRemoveItem');
        toast.error(message);
      } finally {
        setRemovingId(null);
      }
    });
  };

  const handleClearCart = () => {
    startTransition(async () => {
      try {
        await clearCartAction();
        const updated = await getCurrentCart();
        setCartData(updated);
        queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        toast.success(t('cartCleared'));
        router.refresh();
      } catch (error) {
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
      }
    });
  };

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  if (cartData.items.length === 0) {
    if (isMerging) {
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
          <Button onClick={() => router.push(lp('/dashboard/talent/photos'))} variant="outline">
            {t('viewMyPhotos')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2 md:mb-0">
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
                <AlertDialogAction
                  onClick={handleClearCart}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t('clearCart')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-6 pb-20 md:pb-0">
        {/* Left side - Cart items */}
        <div className="flex-2 min-w-0">
          <div className="space-y-3">
            {cartData.items.map((item) => (
              <div
                key={item.photoId}
                className="group flex gap-4 rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-md"
              >
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {item.previewUrl ? (
                    <Image
                      src={item.previewUrl}
                      alt={item.eventTitle || t('photoAlt')}
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                      sizes="80px"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-2 min-w-0">
                  <div>
                    {item.eventTitle && (
                      <h4 className="font-semibold text-base text-foreground line-clamp-1">
                        {item.eventTitle}
                      </h4>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      {item.photographerName && (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5" />
                          <span className="line-clamp-1">{item.photographerName}</span>
                        </div>
                      )}
                      {item.eventDate && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>{format(new Date(item.eventDate), 'MMM d, yyyy')}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold text-foreground">
                        {formatPrice(item.unitPriceCents)}
                      </span>
                      {item.unitPriceCents === 0 && (
                        <span className="text-xs font-medium text-green-600 dark:text-green-400">
                          {t('free')}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(item.photoId)}
                      disabled={isPending && removingId === item.photoId}
                      className="text-foreground/90 hover:text-foreground hover:bg-muted shrink-0"
                    >
                      {isPending && removingId === item.photoId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4 mr-2" />
                          <span className="hidden sm:inline">{t('remove')}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right side - Summary (desktop only) */}
        <div className="hidden md:block flex-1 min-w-0">
          <div className="sticky top-4 self-start rounded-lg border border-border bg-card p-6 shadow-lg">
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

      {/* Mobile summary - sticky footer */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card shadow-lg">
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
    </div>
  );
}
