/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderWithItemCount } from '@/app/[lang]/dashboard/talent/orders/actions';
import { OrdersList } from '@/app/[lang]/dashboard/talent/orders/orders-list';
import en from '@/dictionaries/en.json';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

afterEach(cleanup);

function baseOrder(overrides: Partial<OrderWithItemCount> = {}): OrderWithItemCount {
  return {
    id: 'order-1234-5678',
    status: 'completed',
    total_amount_cents: 500,
    currency: 'usd',
    created_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-01-01T00:00:00.000Z',
    item_count: 2,
    thumbnails: ['https://example.test/photos/a.jpg'],
    ...overrides,
  };
}

function renderOrders(orders: OrderWithItemCount[]) {
  return render(
    <TranslationsProvider translations={en.ordersList}>
      <OrdersList orders={orders} />
    </TranslationsProvider>,
  );
}

// T-116: orders are historical purchase records — a photo/event that's since
// been deleted (dev cleanup, legit) must never surface as a broken <img> or a
// blank gap in the order history. Two distinct ways a thumbnail slot goes
// bad: the order_item's photo row is already gone (`thumbnails[i] === null`,
// server never had a URL to hand back), or the row survives but the signed
// URL 404s client-side (the underlying storage object was removed).
describe('OrdersList (T-116 deleted-photo fallback)', () => {
  it('shows a "photo no longer available" fallback for a slot with no photo row, instead of skipping or breaking it', () => {
    const order = baseOrder({
      item_count: 2,
      thumbnails: ['https://example.test/photos/a.jpg', null],
    });
    const { container } = renderOrders([order]);

    // Only the slot with a real URL renders as an <img> — the null slot never
    // gets a broken `src`. (Thumbnails use alt="" — decorative — so they
    // don't carry an implicit "img" ARIA role; query the DOM directly.)
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByText(en.ordersList.photoNoLongerAvailable)).toBeTruthy();
  });

  it('swaps a thumbnail to the fallback when its signed URL fails to load (storage object gone)', () => {
    const order = baseOrder({
      item_count: 1,
      thumbnails: ['https://example.test/photos/deleted-storage-object.jpg'],
    });
    const { container } = renderOrders([order]);

    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    fireEvent.error(img as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(en.ordersList.photoNoLongerAvailable)).toBeTruthy();
  });

  it('never touches order data — the fallback is presentation-only', () => {
    const order = baseOrder({
      item_count: 3,
      thumbnails: [null, null, null],
    });
    const { container } = renderOrders([order]);

    // The order's item count (a billing fact) still reflects all 3 items,
    // even though every preview is unavailable.
    expect(screen.getByText(/3/)).toBeTruthy();
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
