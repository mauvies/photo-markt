'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { GUEST_CART_KEY, type GuestCartItem, parseGuestCart } from '@/lib/guest-cart';

interface GuestCartContextValue {
  items: GuestCartItem[];
  itemCount: number;
  subtotalCents: number;
  /** False until localStorage has been read on mount. Consumers must not treat
   * an empty cart as "genuinely empty" while this is false — the items may
   * simply not have loaded yet, which would flash the empty state (T-176). */
  hydrated: boolean;
  addItem: (item: GuestCartItem) => void;
  removeItem: (photoId: string) => void;
  clearCart: () => void;
  hasItem: (photoId: string) => boolean;
}

const GuestCartContext = createContext<GuestCartContextValue>({
  items: [],
  itemCount: 0,
  subtotalCents: 0,
  hydrated: false,
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
    setItems(parseGuestCart(localStorage.getItem(GUEST_CART_KEY)));
    setHydrated(true);
  }, []);

  // Adopt what another tab wrote (T-223). Without this the two tabs diverge and
  // the next write from the stale one clobbers the other's cart wholesale, since
  // each serializes its own array over the same key. The `storage` event only
  // fires in the OTHER tabs, so this can't loop with the persist effect below.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // `key === null` is `localStorage.clear()` — it carries no `newValue`, so
      // re-read the key instead of assuming the cart is gone.
      if (event.key !== null && event.key !== GUEST_CART_KEY) return;
      const raw = event.key === null ? localStorage.getItem(GUEST_CART_KEY) : event.newValue;
      const next = parseGuestCart(raw);
      // Keep the previous reference when nothing actually changed: a plain
      // setItems would re-render every consumer (cart badge, every gallery
      // add-button) on a write that said the same thing.
      setItems((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
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
        hydrated,
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
