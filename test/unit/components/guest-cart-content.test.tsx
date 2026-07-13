/** @vitest-environment happy-dom */
/**
 * T-115 — the guest cart rendered the `previewUrl` snapshot stashed in
 * `GuestCartItem` at add-to-cart time: a signed Supabase original that
 * expires after ~1h (`createSignedUrls`, `expiresIn: 3600`). A photo added
 * more than an hour ago showed a broken image even though it was still
 * active. The cart must resolve the CURRENT preview live instead.
 *
 * Regression: the rendered <img> must use the freshly-resolved preview URL
 * (from `resolveGuestCartPreviewsAction`), not the stale `item.previewUrl`
 * snapshot — even when the two differ. Fails before the fix, passes after.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

const STALE_SNAPSHOT_URL =
  'https://ref.supabase.co/storage/v1/object/sign/photos/owner/event/photo.jpg?token=expired';
const LIVE_PREVIEW_URL = '/api/thumb/owner/event/thumbs/photo/medium.webp';

const resolveGuestCartPreviewsAction = vi.fn();

// `./actions` is a "use server" module — mock it so the client test doesn't
// pull server-only code.
vi.mock('@/app/[lang]/cart/actions', () => ({
  createGuestCheckoutSessionAction: vi.fn(),
  resolveGuestCartPreviewsAction: (...args: unknown[]) => resolveGuestCartPreviewsAction(...args),
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

vi.mock('@/components/guest-cart-provider', () => ({
  useGuestCart: () => ({
    items: [CART_ITEM],
    itemCount: 1,
    subtotalCents: 1500,
    addItem: vi.fn(),
    removeItem: vi.fn(),
    clearCart: vi.fn(),
    hasItem: () => false,
  }),
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
  resolveGuestCartPreviewsAction.mockReset();
});

describe('GuestCartContent — live preview resolution (T-115)', () => {
  it('renders the freshly-resolved preview, not the stale localStorage snapshot', async () => {
    resolveGuestCartPreviewsAction.mockResolvedValue({ 'photo-1': LIVE_PREVIEW_URL });

    renderCart();

    const img = await waitFor(() => screen.getByAltText('Surf Cup') as HTMLImageElement);
    expect(img.getAttribute('src')).toBe(LIVE_PREVIEW_URL);
    expect(img.getAttribute('src')).not.toBe(STALE_SNAPSHOT_URL);
  });

  it('resolves preview URLs by the current photo ids, not from the cached item', () => {
    resolveGuestCartPreviewsAction.mockResolvedValue({ 'photo-1': LIVE_PREVIEW_URL });

    renderCart();

    expect(resolveGuestCartPreviewsAction).toHaveBeenCalledWith(['photo-1']);
  });
});
