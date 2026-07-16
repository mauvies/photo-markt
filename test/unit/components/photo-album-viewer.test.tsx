/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mutable URL state so a test can simulate a photo being open (`?photo=…`)
// without re-mocking. Defaults to closed (empty) for every existing test.
const { mockNav } = vi.hoisted(() => ({ mockNav: { params: new URLSearchParams() } }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/es/events/some-event',
  useSearchParams: () => mockNav.params,
}));

// The detail modal / lightbox are code-split via next/dynamic (T-126). Stub the
// dynamic wrapper with a synchronous marker so a test can assert whether the
// overlay is mounted (the deferred-load gate) without resolving the real
// server-coupled module or waiting on the async import.
vi.mock('next/dynamic', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    default: () => () => React.createElement('div', { 'data-testid': 'lazy-overlay' }),
  };
});

// PhotoIconButtons and PhotoLightbox transitively import this Server Action
// module (for the untag flow); it pulls in `supabaseAdmin`, which throws
// under a browser-like test environment. The tiles below never load their
// image (no real network in jsdom), so the action is never actually invoked.
vi.mock('@/app/[lang]/dashboard/photographer/events/[id]/actions', () => ({
  untagPhotoForTalentAction: vi.fn(),
}));

import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';

afterEach(() => {
  cleanup();
  // Reset to the default (closed) URL so tests don't leak the open state.
  mockNav.params = new URLSearchParams();
});

function makeBatch(ids: string[]): PhotoAlbumItem[] {
  return ids.map((id) => ({ id, url: `/${id}.jpg` }));
}

describe('PhotoAlbumViewer grid', () => {
  it('renders every photo inside a single uniform grid, regardless of pagination batches', () => {
    // Two "pages" as `itemBatches` — the old RowsPhotoAlbum-per-segment layout
    // would have rendered one justified-rows album per batch, re-starting its
    // row-packing pattern on every page. The fixed-column grid renders all
    // pages as one continuous container instead.
    const { container } = render(
      <PhotoAlbumViewer itemBatches={[makeBatch(['a', 'b']), makeBatch(['c'])]} />,
    );

    const grids = container.querySelectorAll('.grid-cols-2');
    expect(grids).toHaveLength(1);

    const tiles = grids[0].querySelectorAll('[role="button"]');
    expect(tiles).toHaveLength(3);
  });

  it('applies the same fixed column classes independent of item count', () => {
    const { container: single } = render(<PhotoAlbumViewer items={makeBatch(['a'])} />);
    const { container: many } = render(
      <PhotoAlbumViewer items={makeBatch(['a', 'b', 'c', 'd'])} />,
    );

    const singleGrid = single.querySelector('.grid-cols-2');
    const manyGrid = many.querySelector('.grid-cols-2');
    expect(singleGrid).not.toBeNull();
    expect(manyGrid).not.toBeNull();
    expect(singleGrid?.className).toBe(manyGrid?.className);
  });

  // Regression: the above-the-fold first row must load eagerly so the LCP tile
  // isn't deferred (Next.js flags a lazy LCP image in dev). `next/image`
  // renders priority tiles without a `loading` attribute and lazy tiles with
  // `loading="lazy"`; the widest breakpoint shows 5 per row, so the first 5
  // are primed and the rest stay lazy.
  it('marks only the first row of tiles as priority (eager); later tiles stay lazy', () => {
    const { container } = render(
      <PhotoAlbumViewer items={makeBatch(['a', 'b', 'c', 'd', 'e', 'f'])} />,
    );
    const loadings = Array.from(container.querySelectorAll('.grid-cols-2 [role="button"]')).map(
      (tile) => tile.querySelector('img')?.getAttribute('loading'),
    );

    expect(loadings).toHaveLength(6);
    expect(loadings.slice(0, 5).every((l) => l !== 'lazy')).toBe(true);
    expect(loadings[5]).toBe('lazy');
  });

  // Regression (T-123): priority tiles are LCP candidates — their image must be
  // visible from the first paint (no `opacity-0` gate that waits for hydration
  // + onLoad), with the loading skeleton rendered BEHIND the image (earlier in
  // DOM order) so progressive decoding paints over it. Below-the-fold tiles
  // keep the covering skeleton + fade-in.
  it('does not gate priority-tile image visibility on onLoad; skeleton sits behind the image', () => {
    const { container } = render(
      <PhotoAlbumViewer items={makeBatch(['a', 'b', 'c', 'd', 'e', 'f'])} />,
    );
    const tiles = Array.from(container.querySelectorAll('.grid-cols-2 [role="button"]'));

    // happy-dom never fires image load events, so every tile is still in its
    // "loading" state here — exactly the pre-hydration/pre-load situation.
    const priorityImg = tiles[0].querySelector('img');
    expect(priorityImg?.className).not.toContain('opacity-0');

    const prioritySkeleton = tiles[0].querySelector('[data-slot="skeleton"]');
    expect(prioritySkeleton).not.toBeNull();
    // Skeleton before the image in DOM order → painted behind it.
    expect(
      priorityImg &&
        prioritySkeleton &&
        prioritySkeleton.compareDocumentPosition(priorityImg) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the opacity fade + covering skeleton for below-the-fold tiles', () => {
    const { container } = render(
      <PhotoAlbumViewer items={makeBatch(['a', 'b', 'c', 'd', 'e', 'f'])} />,
    );
    const tiles = Array.from(container.querySelectorAll('.grid-cols-2 [role="button"]'));

    const lazyImg = tiles[5].querySelector('img');
    expect(lazyImg?.className).toContain('opacity-0');

    const lazySkeleton = tiles[5].querySelector('[data-slot="skeleton"]');
    expect(lazySkeleton).not.toBeNull();
    // Covering skeleton comes after the image in DOM order.
    expect(
      lazyImg &&
        lazySkeleton &&
        lazyImg.compareDocumentPosition(lazySkeleton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// T-126: the detail modal / lightbox are lazy-loaded (next/dynamic) and gated on
// first open, so their chunk stays out of the gallery's first load. These lock
// in the gate — the overlay must NOT mount while the gallery is closed, and MUST
// mount when a photo is open (incl. a deep-linked `?photo=`), so opening keeps
// working after the split.
describe('PhotoAlbumViewer deferred overlay (T-126)', () => {
  it('does not mount the detail/lightbox overlay while no photo is open', () => {
    mockNav.params = new URLSearchParams();
    const { queryByTestId } = render(<PhotoAlbumViewer items={makeBatch(['a', 'b'])} />);
    expect(queryByTestId('lazy-overlay')).toBeNull();
  });

  it('mounts the overlay when a photo is open (deep-linked ?photo=)', () => {
    mockNav.params = new URLSearchParams('photo=a');
    const { queryByTestId } = render(<PhotoAlbumViewer items={makeBatch(['a', 'b'])} />);
    expect(queryByTestId('lazy-overlay')).not.toBeNull();
  });
});
