/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GuestCartProvider, useGuestCart } from '@/components/guest-cart-provider';
import { GUEST_CART_KEY, type GuestCartItem } from '@/lib/guest-cart';

function item(photoId: string, unitPriceCents = 500): GuestCartItem {
  return {
    photoId,
    photographerId: 'photographer-1',
    eventId: 'event-1',
    eventName: 'Marathon',
    eventDate: '2026-05-01',
    unitPriceCents,
    previewUrl: null,
  };
}

/** Reads the provider's state out into the DOM so assertions can see it. */
function CartProbe() {
  const { items, itemCount, subtotalCents, hydrated } = useGuestCart();
  return (
    <div>
      <span data-testid="ids">{items.map((i) => i.photoId).join(',')}</span>
      <span data-testid="count">{itemCount}</span>
      <span data-testid="subtotal">{subtotalCents}</span>
      <span data-testid="hydrated">{String(hydrated)}</span>
    </div>
  );
}

function renderCart() {
  return render(
    <GuestCartProvider>
      <CartProbe />
    </GuestCartProvider>,
  );
}

/**
 * Simulate the OTHER tab writing the key. A real `storage` event never fires in
 * the tab that wrote it, so the write is applied to localStorage here (as the
 * other tab would have) and only the event is delivered to this one.
 */
function writeFromOtherTab(items: GuestCartItem[] | null) {
  const newValue = items === null ? null : JSON.stringify(items);
  if (newValue === null) {
    localStorage.removeItem(GUEST_CART_KEY);
  } else {
    localStorage.setItem(GUEST_CART_KEY, newValue);
  }
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: GUEST_CART_KEY, newValue }));
  });
}

function ids() {
  return screen.getByTestId('ids').textContent;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

// T-223: the provider read localStorage on mount and wrote on every change, but
// never listened for `storage`. Two open tabs diverged, and the next write from
// the stale one clobbered the other's cart wholesale — each serializes its own
// array over the same key.
describe('GuestCartProvider cross-tab sync (T-223)', () => {
  it('adopts a cart another tab wrote', () => {
    renderCart();
    expect(ids()).toBe('');

    writeFromOtherTab([item('photo-a'), item('photo-b', 700)]);

    expect(ids()).toBe('photo-a,photo-b');
    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(screen.getByTestId('subtotal').textContent).toBe('1200');
  });

  it('does not clobber the other tab: its own next write keeps what arrived', () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([item('mine')]));
    renderCart();
    expect(ids()).toBe('mine');

    // The other tab adds one of its own on top of ours.
    writeFromOtherTab([item('mine'), item('theirs')]);
    expect(ids()).toBe('mine,theirs');

    // Whatever this tab writes next must build on that, not on its stale array.
    const stored = JSON.parse(localStorage.getItem(GUEST_CART_KEY) ?? '[]') as GuestCartItem[];
    expect(stored.map((i) => i.photoId)).toEqual(['mine', 'theirs']);
  });

  it('converges when the other tab empties the cart', () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([item('photo-a')]));
    renderCart();
    expect(ids()).toBe('photo-a');

    writeFromOtherTab([]);

    expect(ids()).toBe('');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('re-reads the key when another tab calls localStorage.clear() (key === null)', () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([item('photo-a')]));
    renderCart();
    expect(ids()).toBe('photo-a');

    localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    });

    expect(ids()).toBe('');
  });

  it('ignores writes to unrelated keys', () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([item('photo-a')]));
    renderCart();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key', newValue: '[]' }));
    });

    expect(ids()).toBe('photo-a');
  });

  it('falls back to an empty cart on a malformed payload instead of crashing', () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([item('photo-a')]));
    renderCart();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: GUEST_CART_KEY, newValue: '{not json' }),
      );
    });

    expect(ids()).toBe('');
    expect(screen.getByTestId('subtotal').textContent).toBe('0');
  });

  // T-176: consumers must not treat an empty cart as genuinely empty until
  // `hydrated` is true, or the empty state flashes. A cross-tab update must
  // never send that flag backwards.
  it('keeps `hydrated` true across a cross-tab update (T-176 regression)', () => {
    renderCart();
    expect(screen.getByTestId('hydrated').textContent).toBe('true');

    writeFromOtherTab([item('photo-a')]);
    expect(screen.getByTestId('hydrated').textContent).toBe('true');

    writeFromOtherTab([]);
    expect(screen.getByTestId('hydrated').textContent).toBe('true');
  });
});
