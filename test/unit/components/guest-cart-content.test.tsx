/** @vitest-environment happy-dom */
/**
 * T-115 — the guest cart rendered the `previewUrl` snapshot stashed in
 * `GuestCartItem` at add-to-cart time: a signed Supabase original that
 * expires after ~1h (`createSignedUrls`, `expiresIn: 3600`). A photo added
 * more than an hour ago showed a broken image even though it was still
 * active. The cart must resolve the CURRENT preview live instead.
 *
 * T-117 — a guest cart item whose photo has since become unpurchasable
 * (deleted, event soft-deleted, or no longer approved) must be dropped from
 * the cart and the user notified, instead of lingering forever in
 * localStorage.
 *
 * Regression: the rendered <img> must use the freshly-resolved preview URL
 * (from `loadGuestCartStateAction`), not the stale `item.previewUrl`
 * snapshot — even when the two differ. Fails before the fix, passes after.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // biome-ignore lint/performance/noImgElement: plain <img> stub for next/image in tests
    return <img src={src} alt={alt} />;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-localized-path', () => ({
  useLocalizedPath: () => (path: string) => path,
}));

vi.mock('@/hooks/use-login-href', () => ({
  useLoginHref: () => () => '/login',
  useSignupHref: () => () => '/signup',
}));

vi.mock('@/lib/i18n/translations-provider', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}));

// PhotoLightbox pulls a heavy import tree and only renders on interaction.
vi.mock('@/components/photo-lightbox', () => ({ PhotoLightbox: () => null }));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

const STALE_SNAPSHOT_URL =
  'https://ref.supabase.co/storage/v1/object/sign/photos/owner/event/photo.jpg?token=expired';
const LIVE_PREVIEW_URL = '/api/thumb/owner/event/thumbs/photo/medium.webp';

const loadGuestCartStateAction = vi.fn();
const createGuestCheckoutSessionAction = vi.fn();

// `./actions` is a "use server" module — mock it so the client test doesn't
// pull server-only code.
vi.mock('@/app/[lang]/cart/actions', () => ({
  createGuestCheckoutSessionAction: (...args: unknown[]) =>
    createGuestCheckoutSessionAction(...args),
  loadGuestCartStateAction: (...args: unknown[]) => loadGuestCartStateAction(...args),
}));

const CART_ITEM = {
  photoId: 'photo-1',
  photographerId: 'pg-1',
  eventId: 'event-1',
  eventName: 'Surf Cup',
  eventDate: '2026-01-01',
  eventShareCode: 'ABC123',
  unitPriceCents: 1500,
  previewUrl: STALE_SNAPSHOT_URL,
};

const removeItemMock = vi.fn();

// Mutable so individual tests can drive the hydration/items state the provider
// exposes (T-176). Defaults to a hydrated cart with one item, matching the
// pre-existing tests below.
const guestCartValue = {
  items: [CART_ITEM] as (typeof CART_ITEM)[],
  itemCount: 1,
  subtotalCents: 1500,
  hydrated: true,
  addItem: vi.fn(),
  removeItem: removeItemMock,
  clearCart: vi.fn(),
  hasItem: () => false,
};

vi.mock('@/components/guest-cart-provider', () => ({
  useGuestCart: () => guestCartValue,
}));

import { GuestCartContent } from '@/app/[lang]/cart/guest-cart-content';

function renderCart() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GuestCartContent />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  loadGuestCartStateAction.mockReset();
  createGuestCheckoutSessionAction.mockReset();
  removeItemMock.mockReset();
  toastMock.mockClear();
  toastMock.error.mockClear();
  // Restore the default hydrated-with-one-item state for the next test.
  guestCartValue.items = [CART_ITEM];
  guestCartValue.itemCount = 1;
  guestCartValue.subtotalCents = 1500;
  guestCartValue.hydrated = true;
});

describe('GuestCartContent — live preview resolution (T-115)', () => {
  it('renders the freshly-resolved preview, not the stale localStorage snapshot', async () => {
    loadGuestCartStateAction.mockResolvedValue({
      removedPhotoIds: [],
      previews: { 'photo-1': LIVE_PREVIEW_URL },
    });

    renderCart();

    const img = await waitFor(() => screen.getByAltText('Surf Cup') as HTMLImageElement);
    expect(img.getAttribute('src')).toBe(LIVE_PREVIEW_URL);
    expect(img.getAttribute('src')).not.toBe(STALE_SNAPSHOT_URL);
  });

  it('resolves preview URLs by the current photo ids + share codes + photographer ids, not from the cached item', () => {
    loadGuestCartStateAction.mockResolvedValue({
      removedPhotoIds: [],
      previews: { 'photo-1': LIVE_PREVIEW_URL },
      photographers: {},
    });

    renderCart();

    // The item's event share code is passed as access proof (T-132) so a
    // private-event preview resolves only when the guest actually holds the
    // code; the photographer ids resolve the photographer name/slug shown per
    // item (parity with the authenticated cart).
    expect(loadGuestCartStateAction).toHaveBeenCalledWith(['photo-1'], ['ABC123'], ['pg-1']);
  });
});

describe('GuestCartContent — unavailable item cleanup (T-117)', () => {
  it('removes an item reported as no longer purchasable and shows a notice', async () => {
    loadGuestCartStateAction.mockResolvedValue({
      removedPhotoIds: ['photo-1'],
      previews: {},
    });

    renderCart();

    await waitFor(() => expect(removeItemMock).toHaveBeenCalledWith('photo-1'));
    expect(toastMock).toHaveBeenCalledWith('itemsUnavailableRemoved');
  });

  it('does not remove anything or notify when every item is still purchasable', async () => {
    loadGuestCartStateAction.mockResolvedValue({
      removedPhotoIds: [],
      previews: { 'photo-1': LIVE_PREVIEW_URL },
    });

    renderCart();

    await waitFor(() => screen.getByAltText('Surf Cup'));
    expect(removeItemMock).not.toHaveBeenCalled();
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

describe('GuestCartContent — withdrawal consent gate (T-228)', () => {
  it('keeps checkout unreachable until the consent is ticked', async () => {
    loadGuestCartStateAction.mockResolvedValue({
      removedPhotoIds: [],
      previews: { 'photo-1': LIVE_PREVIEW_URL },
    });
    createGuestCheckoutSessionAction.mockResolvedValue({
      ok: true,
      url: 'https://checkout.stripe.test/s',
    });

    renderCart();
    await waitFor(() => screen.getByAltText('Surf Cup'));

    for (const button of screen.getAllByText('proceedToCheckout')) {
      expect(button.closest('button')?.disabled).toBe(true);
    }
    fireEvent.click(screen.getAllByText('proceedToCheckout')[0]);
    expect(createGuestCheckoutSessionAction).not.toHaveBeenCalled();

    tickWithdrawalConsent();

    for (const button of screen.getAllByText('proceedToCheckout')) {
      expect(button.closest('button')?.disabled).toBe(false);
    }
  });

  it('passes the consent through to the Server Action', async () => {
    loadGuestCartStateAction.mockResolvedValue({
      removedPhotoIds: [],
      previews: { 'photo-1': LIVE_PREVIEW_URL },
    });
    createGuestCheckoutSessionAction.mockResolvedValue({
      ok: true,
      url: 'https://checkout.stripe.test/s',
    });

    renderCart();
    await waitFor(() => screen.getByAltText('Surf Cup'));
    tickWithdrawalConsent();
    fireEvent.click(screen.getAllByText('proceedToCheckout')[0]);

    await waitFor(() =>
      expect(createGuestCheckoutSessionAction).toHaveBeenCalledWith(expect.anything(), true),
    );
  });
});

describe('GuestCartContent — typed checkout failure (T-189 / T-117)', () => {
  it('shows the localized reason and re-validates the cart on items_unavailable', async () => {
    loadGuestCartStateAction.mockResolvedValue({
      removedPhotoIds: [],
      previews: { 'photo-1': LIVE_PREVIEW_URL },
    });
    // T-189: the action now RETURNS a typed code instead of throwing (Next
    // redacts thrown Server Action messages in prod) — exercise the `!res.ok`
    // branch, not the surviving catch path.
    createGuestCheckoutSessionAction.mockResolvedValue({ ok: false, error: 'items_unavailable' });

    renderCart();
    await waitFor(() => screen.getByAltText('Surf Cup'));
    loadGuestCartStateAction.mockClear();

    tickWithdrawalConsent();
    // Two checkout buttons render (desktop summary + mobile sticky footer).
    fireEvent.click(screen.getAllByText('proceedToCheckout')[0]);

    // The mapped localized key is toasted so the buyer learns the reason.
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('itemsUnavailableRemoved'));
    // items_unavailable re-validates ['guest-cart-state'] so the self-heal
    // effect can drop the now-unpurchasable item.
    await waitFor(() => expect(loadGuestCartStateAction).toHaveBeenCalled());
  });

  // Was `photographer_not_connected` until that code was retired — an unpayable
  // photographer no longer blocks the sale, the money is held instead. The
  // property under test is unchanged: an error that left the cart valid must not
  // trigger a re-validation round-trip.
  it('shows the localized reason and does NOT re-validate on rate_limited', async () => {
    loadGuestCartStateAction.mockResolvedValue({
      removedPhotoIds: [],
      previews: { 'photo-1': LIVE_PREVIEW_URL },
    });
    createGuestCheckoutSessionAction.mockResolvedValue({
      ok: false,
      error: 'rate_limited',
    });

    renderCart();
    await waitFor(() => screen.getByAltText('Surf Cup'));
    loadGuestCartStateAction.mockClear();

    tickWithdrawalConsent();
    fireEvent.click(screen.getAllByText('proceedToCheckout')[0]);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('checkoutRateLimited'));
    // The cart is still valid → no needless re-validation round-trip.
    expect(loadGuestCartStateAction).not.toHaveBeenCalled();
  });
});

describe('GuestCartContent — no empty-state flash before hydration (T-176)', () => {
  it('renders a skeleton, not the empty state, while the cart is still hydrating from localStorage', () => {
    // A populated localStorage cart is `items: []` on the first client render,
    // before the provider's mount effect reads it (`hydrated: false`).
    guestCartValue.items = [];
    guestCartValue.itemCount = 0;
    guestCartValue.subtotalCents = 0;
    guestCartValue.hydrated = false;

    const { container } = renderCart();

    // Before the fix, an unhydrated empty `items` fell straight through to the
    // empty state, flashing "empty" on a cart that may actually have items.
    // After the fix, a skeleton shows until hydration resolves.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByText('empty')).toBeNull();
    expect(screen.queryByText('browseEvents')).toBeNull();
  });

  it('renders the empty state once hydration confirms the cart is genuinely empty', () => {
    guestCartValue.items = [];
    guestCartValue.itemCount = 0;
    guestCartValue.subtotalCents = 0;
    guestCartValue.hydrated = true;

    const { container } = renderCart();

    expect(screen.getByText('empty')).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
  });
});
