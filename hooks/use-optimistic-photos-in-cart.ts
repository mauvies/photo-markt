'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';

type Action = { type: 'add' | 'remove'; photoId: string };

function reducer(state: Set<string>, action: Action): Set<string> {
  const next = new Set(state);
  if (action.type === 'add') next.add(action.photoId);
  else next.delete(action.photoId);
  return next;
}

type UseOptimisticPhotosInCartArgs = {
  /** Server-confirmed cart contents at mount. */
  initialPhotosInCart: Set<string>;
  /** Server action that adds a photo to the authenticated user's cart. */
  addServerAction: (photoId: string) => Promise<void>;
  /** Server action that removes a photo from the authenticated user's cart. */
  removeServerAction: (photoId: string) => Promise<void>;
  /** Localized failure toasts. */
  toastLabels: { failedAdd: string; failedRemove: string };
};

/**
 * Optimistic toggle of "is this photo in my cart" using React 19's
 * `useOptimistic`. The displayed Set updates instantly inside the same
 * frame as the click — the server action runs in the background.
 *
 * The cart-count badge in the header (a `@tanstack/react-query` consumer
 * of `['cart-count']`) is kept in sync via `queryClient.setQueryData` so
 * icon and badge animate together. On success we `invalidateQueries` to
 * reconcile with server truth (handles rate-limited / duplicate-suppressed
 * edge cases). On failure we revert both: `useOptimistic` reverts the Set
 * automatically when the transition unwinds (because we never updated the
 * confirmed state), and we compensate the optimistic badge increment.
 *
 * Concurrency: rapid taps on the same photo naturally toggle via the
 * optimistic Set (PhotoIconButtons reads from this Set to decide which
 * callback to fire). Each tap fires its own server action; the final
 * invalidate reconciles. No debounce/coalesce.
 */
export function useOptimisticPhotosInCart({
  initialPhotosInCart,
  addServerAction,
  removeServerAction,
  toastLabels,
}: UseOptimisticPhotosInCartArgs) {
  const queryClient = useQueryClient();
  // Confirmed (server-truth) set. Optimistic state derives from this.
  const [confirmed, setConfirmed] = useState<Set<string>>(initialPhotosInCart);
  const [photosInCart, addOptimistic] = useOptimistic(confirmed, reducer);
  const [, startTransition] = useTransition();

  // If the parent passes a new initialPhotosInCart reference (e.g. after a
  // router.refresh() that re-derives server data), pull the latest values
  // into our confirmed state. Compared by reference — callers that recreate
  // the Set on every render would thrash this; they should memoize.
  useEffect(() => {
    setConfirmed(initialPhotosInCart);
  }, [initialPhotosInCart]);

  const addToCart = useCallback(
    (photoId: string) => {
      startTransition(async () => {
        addOptimistic({ type: 'add', photoId });
        // Optimistic badge bump — matches the icon's instant flip.
        queryClient.setQueryData<number>(['cart-count'], (n = 0) => n + 1);
        try {
          await addServerAction(photoId);
          setConfirmed((prev) => {
            const next = new Set(prev);
            next.add(photoId);
            return next;
          });
          // Reconcile with server truth — covers duplicate-suppression
          // and any other edge cases the action may apply.
          queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        } catch (err) {
          // useOptimistic auto-reverts the Set when this transition ends
          // because we didn't update `confirmed`. Compensate the badge.
          queryClient.setQueryData<number>(['cart-count'], (n = 0) => Math.max(0, n - 1));
          queryClient.invalidateQueries({ queryKey: ['cart-count'] });
          toast.error(err instanceof Error ? err.message : toastLabels.failedAdd);
        }
      });
    },
    [addOptimistic, addServerAction, queryClient, toastLabels.failedAdd],
  );

  const removeFromCart = useCallback(
    (photoId: string) => {
      startTransition(async () => {
        addOptimistic({ type: 'remove', photoId });
        queryClient.setQueryData<number>(['cart-count'], (n = 0) => Math.max(0, n - 1));
        try {
          await removeServerAction(photoId);
          setConfirmed((prev) => {
            const next = new Set(prev);
            next.delete(photoId);
            return next;
          });
          queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        } catch (err) {
          queryClient.setQueryData<number>(['cart-count'], (n = 0) => n + 1);
          queryClient.invalidateQueries({ queryKey: ['cart-count'] });
          toast.error(err instanceof Error ? err.message : toastLabels.failedRemove);
        }
      });
    },
    [addOptimistic, removeServerAction, queryClient, toastLabels.failedRemove],
  );

  return { photosInCart, addToCart, removeFromCart };
}
