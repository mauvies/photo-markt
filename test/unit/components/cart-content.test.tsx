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

const { getCurrentCartMock, createCheckoutSessionActionMock, removePhotoFromCartActionMock } =
  vi.hoisted(() => ({
    getCurrentCartMock: vi.fn(),
    createCheckoutSessionActionMock: vi.fn(),
    removePhotoFromCartActionMock: vi.fn(),
  }));

// `./actions` is a "use server" module — mock it so the client test doesn't pull
// server-only code. Only the runtime functions matter (types are erased).
vi.mock('@/app/[lang]/dashboard/talent/cart/actions', () => ({
  getCurrentCart: getCurrentCartMock,
  clearCartAction: vi.fn(),
  createCheckoutSessionAction: createCheckoutSessionActionMock,
  removePhotoFromCartAction: removePhotoFromCartActionMock,
}));

import type { CartData, CartItemDetail } from '@/app/[lang]/dashboard/talent/cart/actions';
import { CartContent } from '@/app/[lang]/dashboard/talent/cart/cart-content';

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
    },
  ],
  subtotalCents: 1500,
  itemCount: 1,
  removedCount: 0,
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
  getCurrentCartMock.mockReset();
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

describe('CartContent — checkout failure refetches the cart (T-117)', () => {
  it('re-fetches cart-data after a rejected checkout, instead of leaving the stale (already self-healed) cart on screen', async () => {
    createCheckoutSessionActionMock.mockRejectedValue(new Error('itemsUnavailableRemoved'));
    getCurrentCartMock.mockResolvedValue({ ...initialCartData, items: [], itemCount: 0 });

    renderCart();
    // Two checkout buttons render (desktop summary + mobile sticky footer).
    fireEvent.click(screen.getAllByText('proceedToCheckout')[0]);

    // Before the fix, a rejected checkout never invalidated ['cart-data'],
    // so getCurrentCart (called once for the initial query registration,
    // matched by TanStack Query against `initialData` and never re-run) was
    // never called again — the stale, already-server-side-deleted item kept
    // rendering. After the fix, the failure invalidates the query and
    // getCurrentCart is called to refresh it.
    await waitFor(() => expect(getCurrentCartMock).toHaveBeenCalled());
  });
});

const EMPTY_CART: CartData = { items: [], subtotalCents: 0, itemCount: 0, removedCount: 0 };

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
  };
  const itemB: CartItemDetail = { ...itemA, photoId: 'photo-B', eventTitle: 'Event B' };
  const twoItems: CartData = {
    items: [itemA, itemB],
    subtotalCents: 3000,
    itemCount: 2,
    removedCount: 0,
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
