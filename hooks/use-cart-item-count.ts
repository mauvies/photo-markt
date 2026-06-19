'use client';

import { useQuery } from '@tanstack/react-query';
import { getCartItemCountAction } from '@/app/[lang]/dashboard/talent/cart/actions';

/**
 * Live count of items in the authenticated talent cart. Shared by the header
 * cart icon and the mobile bottom-nav cart tab — both read the same
 * `['cart-count']` query key, so react-query serves one cached value to both.
 */
export function useCartItemCount(): number {
  const { data = 0 } = useQuery({
    queryKey: ['cart-count'] as const,
    queryFn: async () => {
      try {
        return await getCartItemCountAction();
      } catch {
        return 0;
      }
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
  return data;
}
