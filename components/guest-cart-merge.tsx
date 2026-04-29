'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { mergeGuestCartAction } from '@/app/[lang]/dashboard/talent/cart/actions';
import { createClient } from '@/database/client';
import { useGuestCart } from './guest-cart-provider';

export const CART_MERGE_STATE_KEY = ['cart-merge-state'] as const;

export function GuestCartMerge({ cartRestoredMessage }: { cartRestoredMessage: string }) {
  const { items, clearCart } = useGuestCart();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Keep a mutable ref so the stable auth subscription always reads latest values
  const latestRef = useRef({ items, clearCart, queryClient, cartRestoredMessage, router });
  latestRef.current = { items, clearCart, queryClient, cartRestoredMessage, router };

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event) => {
      if (event !== 'SIGNED_IN') return;
      const { items, clearCart, queryClient, cartRestoredMessage, router } = latestRef.current;
      if (items.length === 0) return;

      // Signal to cart page that merge is in progress (shows skeleton instead of empty state)
      queryClient.setQueryData(CART_MERGE_STATE_KEY, true);
      try {
        const merged = await mergeGuestCartAction(items);
        if (merged > 0) {
          clearCart();
          queryClient.invalidateQueries({ queryKey: ['cart-count'] });
          // Re-render server components so CartPage fetches fresh cart data
          router.refresh();
          toast.success(cartRestoredMessage);
        }
      } catch {
        // best-effort — never show an error for a failed merge
      } finally {
        queryClient.setQueryData(CART_MERGE_STATE_KEY, false);
      }
    });
    return () => subscription.unsubscribe();
  }, []); // one subscription for the lifetime of the layout

  return null;
}
