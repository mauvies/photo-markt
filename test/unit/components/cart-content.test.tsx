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
import { cleanup, render, screen } from '@testing-library/react';
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

vi.mock('@/hooks/use-localized-path', () => ({
  useLocalizedPath: () => (path: string) => path,
}));

vi.mock('@/lib/i18n/translations-provider', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}));

// PhotoLightbox pulls a heavy import tree and only renders on interaction.
vi.mock('@/components/photo-lightbox', () => ({ PhotoLightbox: () => null }));

// `./actions` is a "use server" module — mock it so the client test doesn't pull
// server-only code. Only the runtime functions matter (types are erased).
vi.mock('@/app/[lang]/dashboard/talent/cart/actions', () => ({
  getCurrentCart: vi.fn(),
  clearCartAction: vi.fn(),
  createCheckoutSessionAction: vi.fn(),
  removePhotoFromCartAction: vi.fn(),
}));

import type { CartData } from '@/app/[lang]/dashboard/talent/cart/actions';
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
};

function renderCart() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CartContent initialCartData={initialCartData} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

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
