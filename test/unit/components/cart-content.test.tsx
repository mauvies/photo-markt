/** @vitest-environment happy-dom */
/**
 * T-111 — the authenticated cart's item preview didn't render (broken image).
 *
 * `previewUrl` is a signed Supabase original (createPhotoUrls, useWatermark:false).
 * The `<Image>` lacked `unoptimized`, so the multi-MB original was routed through
 * the Vercel image optimizer, which times out → broken image. The guest cart
 * already passed `unoptimized`; this pins the authenticated cart to the same.
 *
 * Regression: the preview <img> must serve the signed URL directly (unoptimized),
 * not a `/_next/image?url=…` optimizer URL. Fails before the fix, passes after.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// next/image stub that surfaces the `unoptimized` prop so the test can assert it.
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt, unoptimized } = props as {
      src: string;
      alt: string;
      unoptimized?: boolean;
    };
    // biome-ignore lint/performance/noImgElement: plain <img> stub for next/image in tests
    return <img src={src} alt={alt} data-unoptimized={unoptimized ? 'true' : 'false'} />;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/hooks/use-localized-path', () => ({
  useLocalizedPath: () => (path: string) => path,
}));

vi.mock('@/lib/i18n/translations-provider', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}));

// PhotoLightbox pulls a heavy import tree and only renders on interaction.
vi.mock('@/components/photo-lightbox', () => ({ PhotoLightbox: () => null }));

const {
  getCurrentCartMock,
  clearCartActionMock,
  createCheckoutSessionActionMock,
  removePhotoFromCartActionMock,
  getCartItemCountActionMock,
} = vi.hoisted(() => ({
  getCurrentCartMock: vi.fn(),
  clearCartActionMock: vi.fn(),
  createCheckoutSessionActionMock: vi.fn(),
  removePhotoFromCartActionMock: vi.fn(),
  getCartItemCountActionMock: vi.fn(),
}));

// `./actions` is a "use server" module — mock it so the client test doesn't pull
// server-only code. Only the runtime functions matter (types are erased).
vi.mock('@/app/[lang]/dashboard/talent/cart/actions', () => ({
  getCurrentCart: getCurrentCartMock,
  clearCartAction: clearCartActionMock,
  createCheckoutSessionAction: createCheckoutSessionActionMock,
  removePhotoFromCartAction: removePhotoFromCartActionMock,
  getCartItemCountAction: getCartItemCountActionMock,
}));

import type { CartData, CartItemDetail } from '@/app/[lang]/dashboard/talent/cart/actions';
import { CartContent } from '@/app/[lang]/dashboard/talent/cart/cart-content';
import { useCartItemCount } from '@/hooks/use-cart-item-count';

// Probe that mounts the real nav count hook — it registers the ['cart-count']
// query with its absolute getCartItemCount queryFn, exactly as the persistent
// nav does, so tests can exercise the cross-component count race (T-165).
function NavCountProbe() {
  const count = useCartItemCount();
  return <div data-testid="nav-count">{count}</div>;
}

const SIGNED_ORIGINAL =
  'https://ref.supabase.co/storage/v1/object/sign/photos/owner/event/photo.jpg?token=abc';

const initialCartData: CartData = {
  items: [
    {
      photoId: 'photo-1',
      previewUrl: SIGNED_ORIGINAL,
      photographerId: 'pg-1',
      photographerName: 'Jane Doe',
      photographerSlug: 'jane',
      unitPriceCents: 1500,
      eventTitle: 'Surf Cup',
      eventDate: '2026-01-01',
      eventShareCode: 'ABC123',
      eventId: 'event-1',
      bundleTiers: null,
      bundleAllPhotosCents: null,
      bundleEligible: false,
    },
  ],
  subtotalCents: 1500,
  itemCount: 1,
  removedCount: 0,
  bundleDiscountCents: 0,
  nextTier: null,
};

function renderCart(data: CartData = initialCartData, queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <CartContent initialCartData={data} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient: client };
}

afterEach(() => {
  cleanup();
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  getCartItemCountActionMock.mockReset();
  getCurrentCartMock.mockReset();
  clearCartActionMock.mockReset();
  createCheckoutSessionActionMock.mockReset();
  removePhotoFromCartActionMock.mockReset();
});

describe('CartContent — item preview (T-111)', () => {
  it('renders the preview image', () => {
    renderCart();
    const img = screen.getByAltText('Surf Cup') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(SIGNED_ORIGINAL);
  });

  it('serves the signed original unoptimized (never through the Vercel optimizer)', () => {
    renderCart();
    const img = screen.getByAltText('Surf Cup');
    // Before the fix this was optimized → the optimizer timed out on the
    // multi-MB original → broken image.
    expect(img.getAttribute('data-unoptimized')).toBe('true');
  });
});

describe('CartContent — metadata layout (T-112)', () => {
  it('stacks the photographer and date vertically (date below photographer)', () => {
    renderCart();
    // The photographer link and the date share one metadata block — its direct
    // wrapper is now a vertical stack. Previously it was a horizontal row
    // (flex-wrap items-center), so the immediate parent is asserted directly
    // (not `closest`, which would climb to the outer flex-col content column).
    const wrapper = screen.getByTitle('viewPhotographer').parentElement as HTMLElement;
    expect(wrapper.className).toContain('flex-col');
    expect(wrapper.className).not.toContain('flex-wrap');
    expect(wrapper.className).not.toContain('items-center');
    // Two stacked children: the photographer row and the date row.
    expect(wrapper.childElementCount).toBe(2);
  });
});

describe('CartContent — removal notice (T-117)', () => {
  it('shows a notice when getCurrentCart() reports removed items', () => {
    renderCart({ ...initialCartData, removedCount: 2 });
    expect(toastMock).toHaveBeenCalledWith('itemsUnavailableRemoved');
  });

  it('shows no notice when nothing was removed', () => {
    renderCart({ ...initialCartData, removedCount: 0 });
    expect(toastMock).not.toHaveBeenCalled();
  });
});

/**
 * T-228: checkout is gated on the right-of-withdrawal consent, so every test
 * that means to reach the action has to tick it first. Both render sites
 * (desktop summary + mobile sticky footer) share one piece of state, so
 * ticking either is the same answer.
 */
function tickWithdrawalConsent() {
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
}

describe('CartContent — withdrawal consent gate (T-228)', () => {
  it('keeps checkout unreachable until the consent is ticked', async () => {
    createCheckoutSessionActionMock.mockResolvedValue({
      ok: true,
      url: 'https://checkout.stripe.test/s',
    });

    renderCart();

    for (const button of screen.getAllByText('proceedToCheckout')) {
      expect(button.closest('button')?.disabled).toBe(true);
    }
    fireEvent.click(screen.getAllByText('proceedToCheckout')[0]);
    expect(createCheckoutSessionActionMock).not.toHaveBeenCalled();

    tickWithdrawalConsent();

    for (const button of screen.getAllByText('proceedToCheckout')) {
      expect(button.closest('button')?.disabled).toBe(false);
    }
  });

  it('passes the consent through to the Server Action', async () => {
    createCheckoutSessionActionMock.mockResolvedValue({
      ok: true,
      url: 'https://checkout.stripe.test/s',
    });

    renderCart();
    tickWithdrawalConsent();
    fireEvent.click(screen.getAllByText('proceedToCheckout')[0]);

    await waitFor(() => expect(createCheckoutSessionActionMock).toHaveBeenCalledWith(true));
  });
});

describe('CartContent — typed checkout failure (T-189 / T-117)', () => {
  it('shows the localized reason and re-fetches cart-data on items_unavailable (self-heal)', async () => {
    // T-189: the action now RETURNS a typed code instead of throwing (Next
    // redacts thrown Server Action messages in prod), so exercise the
    // `!res.ok` branch — not the surviving catch path.
    createCheckoutSessionActionMock.mockResolvedValue({ ok: false, error: 'items_unavailable' });
    getCurrentCartMock.mockResolvedValue({ ...initialCartData, items: [], itemCount: 0 });

    renderCart();
    tickWithdrawalConsent();
    // Two checkout buttons render (desktop summary + mobile sticky footer).
    fireEvent.click(screen.getAllByText('proceedToCheckout')[0]);

    // The mapped localized key is toasted so the buyer learns the reason.
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('itemsUnavailableRemoved'));
    // items_unavailable self-heals the cart server-side, so the client refetches
    // (getCurrentCart, otherwise pinned to initialData and never re-run).
    await waitFor(() => expect(getCurrentCartMock).toHaveBeenCalled());
  });

  // Was `photographer_not_connected` until that code was retired — an unpayable
  // photographer no longer blocks the sale, the money is held instead. The
  // property under test is unchanged: any error that did NOT mutate the cart
  // server-side must not trigger a refetch.
  it('shows the localized reason and does NOT refetch on rate_limited', async () => {
    createCheckoutSessionActionMock.mockResolvedValue({
      ok: false,
      error: 'rate_limited',
    });

    renderCart();
    tickWithdrawalConsent();
    fireEvent.click(screen.getAllByText('proceedToCheckout')[0]);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('checkoutRateLimited'));
    // No server-side cart mutation → no needless refetch (getCurrentCart stays
    // pinned to initialData, never invoked).
    expect(getCurrentCartMock).not.toHaveBeenCalled();
  });
});

const EMPTY_CART: CartData = {
  items: [],
  subtotalCents: 0,
  itemCount: 0,
  removedCount: 0,
  bundleDiscountCents: 0,
  nextTier: null,
};

describe('CartContent — live sync with fresh server data (T-121)', () => {
  it('renders the fresh server snapshot even when a stale (empty) cart-data cache exists', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Simulate a prior visit that cached an EMPTY cart (staleTime:Infinity keeps
    // it around). Before the fix this stale cache shadowed the fresh
    // `initialCartData` snapshot from the force-dynamic RSC render, so the page
    // showed the empty state until a manual refresh. After the fix the mount
    // seeds ['cart-data'] with the fresh snapshot, so the item shows instantly.
    queryClient.setQueryData<CartData>(['cart-data'], EMPTY_CART);

    renderCart(initialCartData, queryClient);

    expect(screen.getByText('Surf Cup')).toBeTruthy();
  });
});

describe('CartContent — optimistic remove (T-121)', () => {
  it('drops the item and decrements the badge before the server confirms', async () => {
    // A never-resolving remove so we can observe the pre-confirmation UI.
    removePhotoFromCartActionMock.mockImplementation(() => new Promise<void>(() => {}));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<number>(['cart-count'], 1);

    renderCart(initialCartData, queryClient);
    fireEvent.click(screen.getByText('remove'));

    // Item is gone and the shared badge decremented — without waiting on the server.
    await waitFor(() => expect(screen.queryByText('Surf Cup')).toBeNull());
    expect(queryClient.getQueryData<number>(['cart-count'])).toBe(0);
  });

  it('rolls back the item and badge and toasts on failure', async () => {
    removePhotoFromCartActionMock.mockRejectedValue(new Error('boom'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<number>(['cart-count'], 1);

    renderCart(initialCartData, queryClient);
    fireEvent.click(screen.getByText('remove'));

    // Exact rollback: the item returns and the badge is restored.
    await waitFor(() => expect(screen.getByText('Surf Cup')).toBeTruthy());
    expect(queryClient.getQueryData<number>(['cart-count'])).toBe(1);
    expect(toastMock.error).toHaveBeenCalled();
  });
});

// T-163: a successful delete is silent — the optimistic UI is the only success
// feedback. Only the failure branch notifies (asserted above). The T-117
// auto-heal notice (`itemsUnavailableRemoved`) is NOT a user-action success and
// must stay (covered in the "removal notice" block above).
describe('CartContent — successful delete is silent (T-163)', () => {
  it('does not toast on a successful item removal', async () => {
    removePhotoFromCartActionMock.mockResolvedValue(undefined);
    getCurrentCartMock.mockResolvedValue({
      items: [],
      subtotalCents: 0,
      itemCount: 0,
      removedCount: 0,
      bundleDiscountCents: 0,
      nextTier: null,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<number>(['cart-count'], 1);

    renderCart(initialCartData, queryClient);
    fireEvent.click(screen.getByText('remove'));

    // The item is gone (optimistic), the action resolved, and NO success toast.
    await waitFor(() => expect(removePhotoFromCartActionMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Surf Cup')).toBeNull());
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('does not toast on a successful clear cart', async () => {
    clearCartActionMock.mockResolvedValue(undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<number>(['cart-count'], 1);

    renderCart(initialCartData, queryClient);
    // Open the confirm dialog, then confirm — both the trigger and the action
    // button carry the 'clearCart' label; the action button is the last one.
    fireEvent.click(screen.getByText('clearCart'));
    const clearButtons = screen.getAllByText('clearCart');
    fireEvent.click(clearButtons[clearButtons.length - 1]);

    await waitFor(() => expect(clearCartActionMock).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

describe('CartContent — a delete does not reappear mid-removal (T-162)', () => {
  const itemA: CartItemDetail = {
    photoId: 'photo-A',
    previewUrl: null,
    photographerId: 'pg-1',
    photographerName: 'Jane Doe',
    photographerSlug: 'jane',
    unitPriceCents: 1500,
    eventTitle: 'Event A',
    eventDate: '2026-01-01',
    eventShareCode: 'AAA',
    eventId: 'event-1',
    bundleTiers: null,
    bundleAllPhotosCents: null,
    bundleEligible: false,
  };
  const itemB: CartItemDetail = { ...itemA, photoId: 'photo-B', eventTitle: 'Event B' };
  const twoItems: CartData = {
    items: [itemA, itemB],
    subtotalCents: 3000,
    itemCount: 2,
    removedCount: 0,
    bundleDiscountCents: 0,
    nextTier: null,
  };

  // Symptom 2 of the report: removing items, some come back. The real mechanism
  // is the fresh-snapshot re-seed — a Server Action mutation triggers a route
  // refresh that hands CartContent a new `initialCartData`; if that snapshot was
  // captured before the delete committed on the server, the mount-time re-seed
  // (`setQueryData(['cart-data'], initialCartData)`) overwrites the optimistic
  // removal and the item reappears. The fix skips the re-seed while a removal is
  // still in flight. (React Query already discards out-of-order refetches, so
  // the failure surfaced through this re-seed, not the reconcile.)
  it('a route refresh with a stale snapshot during a pending removal does not resurrect the item', async () => {
    // Removal never resolves → it stays "in flight" for the whole test, so the
    // re-seed guard is under `pendingRemovalsRef > 0` the entire time.
    removePhotoFromCartActionMock.mockImplementation(() => new Promise<void>(() => {}));
    getCurrentCartMock.mockResolvedValue(twoItems);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<number>(['cart-count'], 2);
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CartContent initialCartData={twoItems} />
      </QueryClientProvider>,
    );

    // Remove B optimistically (its server action never confirms).
    await act(async () => {
      fireEvent.click(screen.getAllByText('remove')[1]);
    });
    expect(screen.queryByText('Event B')).toBeNull();
    expect(screen.getByText('Event A')).toBeTruthy();

    // Simulate the Server Action-triggered route refresh: a NEW initialCartData
    // object (new reference → the effect re-runs) whose snapshot predates B's
    // commit, so it still lists B.
    const staleRefresh: CartData = { ...twoItems, items: [itemA, itemB] };
    await act(async () => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <CartContent initialCartData={staleRefresh} />
        </QueryClientProvider>,
      );
    });

    // Before the fix the re-seed overwrote the optimistic state and B came back.
    // After the fix the guard skips the re-seed while the removal is pending.
    expect(screen.queryByText('Event B')).toBeNull();
    expect(screen.getByText('Event A')).toBeTruthy();
  });
});

// T-165: deleting several items fast left the nav cart button stuck on a stale
// count (e.g. 2). The count lives in a separate ['cart-count'] query fed by an
// absolute getCartItemCount SELECT; a reconcile refetch fired mid-sequence could
// observe a partially-committed delete set and resolve AFTER the optimistic 0,
// overwriting it. The fix cancels ['cart-count'] on each removal and derives the
// count from the reconciled ['cart-data'] instead of the racy absolute refetch.
describe('CartContent — nav count stays 0 after deleting all items (T-165)', () => {
  const mk = (id: string, title: string): CartItemDetail => ({
    photoId: id,
    previewUrl: null,
    photographerId: 'pg-1',
    photographerName: 'Jane Doe',
    photographerSlug: 'jane',
    unitPriceCents: 1000,
    eventTitle: title,
    eventDate: '2026-01-01',
    eventShareCode: 'AAA',
    eventId: 'event-1',
    bundleTiers: null,
    bundleAllPhotosCents: null,
    bundleEligible: false,
  });
  const fourItems = [
    mk('p1', 'Event 1'),
    mk('p2', 'Event 2'),
    mk('p3', 'Event 3'),
    mk('p4', 'Event 4'),
  ];
  const fourCart: CartData = {
    items: fourItems,
    subtotalCents: 4000,
    itemCount: 4,
    removedCount: 0,
    bundleDiscountCents: 0,
    nextTier: null,
  };

  it('a late, partial absolute count refetch cannot resurrect the nav count', async () => {
    // Fake server: a delete "commits" when its (immediate) action resolves.
    const committed = new Set<string>();
    removePhotoFromCartActionMock.mockImplementation(async (id: string) => {
      committed.add(id);
    });
    // cart-data reconcile reflects the committed set.
    getCurrentCartMock.mockImplementation(async () => {
      const items = fourItems.filter((i) => !committed.has(i.photoId));
      return {
        items,
        itemCount: items.length,
        subtotalCents: items.reduce((s, i) => s + i.unitPriceCents, 0),
        removedCount: 0,
        bundleDiscountCents: 0,
        nextTier: null,
      };
    });
    // The absolute count SELECT is held open so the test controls when (and with
    // what stale value) it resolves.
    const countResolvers: Array<(n: number) => void> = [];
    getCartItemCountActionMock.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          countResolvers.push(resolve);
        }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed a fresh count so the nav hook doesn't fetch on mount (staleTime 30s).
    queryClient.setQueryData<number>(['cart-count'], 4);
    render(
      <QueryClientProvider client={queryClient}>
        <CartContent initialCartData={fourCart} />
        <NavCountProbe />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('nav-count').textContent).toBe('4');

    // Delete every item, letting each settle (its reconcile fires) before the
    // next — the sequential-fast pattern that produced the stuck count.
    for (let i = 0; i < fourItems.length; i++) {
      await act(async () => {
        // Always remove the first remaining item (the grid shrinks each pass).
        fireEvent.click(screen.getAllByText('remove')[0]);
      });
    }

    // Optimistically empty now.
    await waitFor(() => expect(queryClient.getQueryData<number>(['cart-count'])).toBe(0));

    // Any absolute count refetch the old code queued resolves LAST with a stale
    // partial count (2). With the fix, no such refetch exists (the page derives
    // the count from cart-data), so this is a no-op; without it, the 2 clobbered 0.
    await act(async () => {
      for (const resolve of countResolvers.splice(0)) resolve(2);
    });

    expect(queryClient.getQueryData<number>(['cart-count'])).toBe(0);
    expect(screen.getByTestId('nav-count').textContent).toBe('0');
  });
});
