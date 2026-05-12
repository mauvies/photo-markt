'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { GUEST_CART_KEY, type GuestCartItem } from '@/lib/guest-cart';

interface GuestCartContextValue {
  items: GuestCartItem[];
  itemCount: number;
  subtotalCents: number;
  addItem: (item: GuestCartItem) => void;
  removeItem: (photoId: string) => void;
  clearCart: () => void;
  hasItem: (photoId: string) => boolean;
}

const GuestCartContext = createContext<GuestCartContextValue>({
  items: [],
  itemCount: 0,
  subtotalCents: 0,
  addItem: () => {},
  removeItem: () => {},
  clearCart: () => {},
  hasItem: () => false,
});

export function GuestCartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<GuestCartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GUEST_CART_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setItems(parsed);
      }
    } catch {
      // ignore parse errors
    }
    setHydrated(true);
  }, []);

  // Persist to localStorage on every change (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const addItem = useCallback((item: GuestCartItem) => {
    setItems((prev) => {
      if (prev.some((i) => i.photoId === item.photoId)) return prev;
      return [...prev, item];
    });
  }, []);

  const removeItem = useCallback((photoId: string) => {
    setItems((prev) => prev.filter((i) => i.photoId !== photoId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const hasItem = useCallback(
    (photoId: string) => items.some((i) => i.photoId === photoId),
    [items],
  );

  const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents, 0);

  return (
    <GuestCartContext.Provider
      value={{
        items,
        itemCount: items.length,
        subtotalCents,
        addItem,
        removeItem,
        clearCart,
        hasItem,
      }}
    >
      {children}
    </GuestCartContext.Provider>
  );
}

export function useGuestCart() {
  return useContext(GuestCartContext);
}
