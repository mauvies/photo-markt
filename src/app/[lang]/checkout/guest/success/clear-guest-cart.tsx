'use client';

import { useEffect } from 'react';
import { useGuestCart } from '@/components/guest-cart-provider';

export function ClearGuestCart() {
  const { clearCart } = useGuestCart();

  useEffect(() => {
    clearCart();
  }, [clearCart]);

  return null;
}
