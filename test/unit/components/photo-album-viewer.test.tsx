/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/events/some-event',
  useSearchParams: () => new URLSearchParams(),
}));

// PhotoIconButtons and PhotoLightbox transitively import this Server Action
// module (for the untag flow); it pulls in `supabaseAdmin`, which throws
// under a browser-like test environment. The tiles below never load their
// image (no real network in jsdom), so the action is never actually invoked.
vi.mock('@/app/[lang]/dashboard/photographer/events/[id]/actions', () => ({
  untagPhotoForTalentAction: vi.fn(),
}));

import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';

afterEach(cleanup);

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
});
