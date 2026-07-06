/** @vitest-environment happy-dom */
/**
 * Render smoke test for PhotoDetailModal (T-066): mounts the two-panel modal
 * and asserts the info panel shows attribution, location, date, dimensions,
 * the price, and the correct primary CTA. Guards the component from runtime
 * crashes and pins the panel content.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// next/image → a plain <img> so the carousel renders in happy-dom.
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // biome-ignore lint/performance/noImgElement: plain <img> stub for next/image in tests
    return <img src={src} alt={alt} />;
  },
}));

import { PhotoDetailModal } from '@/components/photo-detail-modal';

const labels = {
  title: 'Photo details',
  pricePerPhoto: 'Price per Photo',
  addToCart: 'Add to Cart',
  inCart: 'Remove from cart',
  download: 'Download',
  share: 'Share',
  close: 'Close',
};

const items = [
  {
    id: 'p1',
    url: '/api/public/preview/p1',
    alt: 'Foto 1',
    width: 7008,
    height: 4672,
    uploader: { name: 'TomasmpBello', isAuthenticated: true },
    location: 'Baia, Peniche, Portugal',
    takenAt: '2026-07-05T10:00:00.000Z',
  },
  { id: 'p2', url: '/api/public/preview/p2', alt: 'Foto 2' },
];

afterEach(cleanup);

describe('PhotoDetailModal', () => {
  it('renders the info panel and an Add to Cart CTA for an unpurchased paid photo', () => {
    render(
      <PhotoDetailModal
        items={items}
        open
        onClose={() => {}}
        labels={labels}
        locale="en"
        pricePerPhoto={10}
        showAddToCart
        showDownload
        canDownloadPhoto={() => false}
        photosInCart={new Set()}
      />,
    );

    expect(screen.getByText('TomasmpBello')).toBeTruthy();
    expect(screen.getByText('Baia, Peniche, Portugal')).toBeTruthy();
    expect(screen.getByText('July 5, 2026')).toBeTruthy();
    expect(screen.getByText('7008 × 4672px')).toBeTruthy();
    expect(screen.getByText('Price per Photo')).toBeTruthy();
    expect(screen.getByText('10.00 USD')).toBeTruthy();
    expect(screen.getByText('Add to Cart')).toBeTruthy();
    // Counter reflects the position.
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('falls back to a linked @username when a photo has no uploader', () => {
    render(
      <PhotoDetailModal
        items={[{ id: 'x', url: '/api/public/preview/x', alt: 'Foto', width: 100, height: 80 }]}
        open
        onClose={() => {}}
        labels={labels}
        locale="en"
        photographerName="janedoe"
        pricePerPhoto={10}
        showAddToCart
      />,
    );

    const link = screen.getByRole('link', { name: '@janedoe' });
    expect(link.getAttribute('href')).toBe('/en/photographer/janedoe');
  });

  it('shows Download for an owned photo instead of the cart', () => {
    render(
      <PhotoDetailModal
        items={items}
        open
        onClose={() => {}}
        labels={labels}
        locale="en"
        pricePerPhoto={10}
        showAddToCart
        showDownload
        canDownloadPhoto={() => true}
        photosInCart={new Set()}
      />,
    );

    expect(screen.getByText('Download')).toBeTruthy();
    expect(screen.queryByText('Add to Cart')).toBeNull();
  });
});
