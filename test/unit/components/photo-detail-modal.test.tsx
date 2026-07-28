/** @vitest-environment happy-dom */
/**
 * Render smoke test for PhotoDetailModal (T-066): mounts the two-panel modal
 * and asserts the info panel shows attribution, location, date, dimensions,
 * the price, and the correct primary CTA. Guards the component from runtime
 * crashes and pins the panel content.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  addToFavorites: 'Add to favorites',
  removeFromFavorites: 'Remove from favorites',
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
    expect(screen.getByText('€10.00')).toBeTruthy();
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

  // T-102 — favorites is a purchase-adjacent secondary action in the right
  // panel (next to the CTA), shown only when the caller opts in (auth-gated).
  describe('favorites (T-102)', () => {
    it('shows the favorites button when showAddToFavorites is set', () => {
      render(
        <PhotoDetailModal
          items={items}
          open
          onClose={() => {}}
          labels={labels}
          locale="en"
          pricePerPhoto={10}
          showAddToCart
          showAddToFavorites
          photosInMyPhotos={new Set()}
          onAddToPhotos={() => {}}
          onRemoveFromPhotos={() => {}}
        />,
      );

      // Both the CTA and the secondary favorites button are present.
      expect(screen.getByText('Add to Cart')).toBeTruthy();
      expect(screen.getByText('Add to favorites')).toBeTruthy();
    });

    it('hides the favorites button for a guest (showAddToFavorites unset)', () => {
      render(
        <PhotoDetailModal
          items={items}
          open
          onClose={() => {}}
          labels={labels}
          locale="en"
          pricePerPhoto={10}
          showAddToCart
        />,
      );

      expect(screen.queryByText('Add to favorites')).toBeNull();
      expect(screen.queryByText('Remove from favorites')).toBeNull();
    });

    it('invokes onAddToPhotos when an un-favorited photo is clicked', () => {
      const onAddToPhotos = vi.fn();
      render(
        <PhotoDetailModal
          items={items}
          open
          onClose={() => {}}
          labels={labels}
          locale="en"
          pricePerPhoto={10}
          showAddToCart
          showAddToFavorites
          photosInMyPhotos={new Set()}
          onAddToPhotos={onAddToPhotos}
          onRemoveFromPhotos={() => {}}
        />,
      );

      fireEvent.click(screen.getByText('Add to favorites'));
      expect(onAddToPhotos).toHaveBeenCalledWith('p1');
    });

    it('shows the filled/remove state and calls onRemoveFromPhotos when already favorited', () => {
      const onRemoveFromPhotos = vi.fn();
      render(
        <PhotoDetailModal
          items={items}
          open
          onClose={() => {}}
          labels={labels}
          locale="en"
          pricePerPhoto={10}
          showAddToCart
          showAddToFavorites
          photosInMyPhotos={new Set(['p1'])}
          onAddToPhotos={() => {}}
          onRemoveFromPhotos={onRemoveFromPhotos}
        />,
      );

      const button = screen.getByText('Remove from favorites');
      expect(button).toBeTruthy();
      expect(screen.queryByText('Add to favorites')).toBeNull();
      fireEvent.click(button);
      expect(onRemoveFromPhotos).toHaveBeenCalledWith('p1');
    });
  });

  // T-077 — Radix's default open-autofocus landed on the carousel's Previous
  // arrow (the first focusable descendant), which then visually read as
  // "selected" no matter which arrow the user actually clicked afterwards.
  describe('arrow focus (T-077)', () => {
    const threeItems = [
      { id: 'p1', url: '/api/public/preview/p1', alt: 'Foto 1' },
      { id: 'p2', url: '/api/public/preview/p2', alt: 'Foto 2' },
      { id: 'p3', url: '/api/public/preview/p3', alt: 'Foto 3' },
    ];

    it('does not auto-focus the Previous arrow when the modal opens', () => {
      render(
        <PhotoDetailModal
          items={threeItems}
          open
          onClose={() => {}}
          labels={labels}
          locale="en"
          pricePerPhoto={10}
          showAddToCart
        />,
      );

      expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Previous photo');
    });

    it('does not leave focus on the Previous arrow after clicking Next', () => {
      render(
        <PhotoDetailModal
          items={threeItems}
          open
          onClose={() => {}}
          labels={labels}
          locale="en"
          pricePerPhoto={10}
          showAddToCart
        />,
      );

      fireEvent.click(screen.getByLabelText('Next photo'));

      expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Previous photo');
    });
  });
});
