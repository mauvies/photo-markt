'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { mergeGuestCartAction } from '@/app/[lang]/dashboard/talent/cart/actions';
import { createClient } from '@/database/client';
import { useGuestCart } from './guest-cart-provider';

export const CART_MERGE_STATE_KEY = ['cart-merge-state'] as const;

export function GuestCartMerge({ cartRestoredMessage }: { cartRestoredMessage: string }) {
  const { items, clearCart } = useGuestCart();
  const queryClient = useQueryClient();

  // Keep a mutable ref so the stable auth subscription always reads latest values
  const latestRef = useRef({ items, clearCart, queryClient, cartRestoredMessage });
  latestRef.current = { items, clearCart, queryClient, cartRestoredMessage };

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event) => {
      if (event !== 'SIGNED_IN') return;
      const { items, clearCart, queryClient, cartRestoredMessage } = latestRef.current;
      if (items.length === 0) return;

      // Signal the cart page to show a skeleton (may already be true from
      // CartContent's useLayoutEffect — setting it again is a no-op).
      queryClient.setQueryData(CART_MERGE_STATE_KEY, true);
      try {
        const merged = await mergeGuestCartAction(items);
        if (merged > 0) {
          // Clear localStorage only after the server confirms items were saved.
          clearCart();
          // Await the refetch so items are visible before the skeleton clears.
          // Without await, finally() would clear the flag while the query is
          // still in-flight, causing an empty-cart flash.
          await queryClient.invalidateQueries({ queryKey: ['cart-data'] });
          queryClient.invalidateQueries({ queryKey: ['cart-count'] });
          toast.success(cartRestoredMessage);
        }
      } catch {
        // best-effort — never show an error for a failed merge
      } finally {
        // By here the refetch completed (items visible) or merge failed.
        queryClient.setQueryData(CART_MERGE_STATE_KEY, false);
      }
    });
    return () => subscription.unsubscribe();
  }, []); // one subscription for the lifetime of the layout

  return null;
}
