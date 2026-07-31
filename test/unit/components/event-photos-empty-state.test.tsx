/** @vitest-environment happy-dom */
/**
 * T-208 — the photographer's Photos tab must not render a blank panel when the
 * event has no photos.
 *
 * Before the fix `EventPhotoAlbum` rendered `PhotoGallery` unconditionally, so a
 * brand-new event showed an empty grid with no icon, no copy and no way to get
 * to the upload form. The empty state is composed by the server page (copy +
 * `/edit` link) and passed in as `emptyState`.
 *
 * Two boundaries are pinned here:
 *  - it appears only when the whole-event total is 0 — NOT while uploads are
 *    still being validated (those count as visible and `PhotosProcessingNotice`
 *    explains them), which is what keeps "no photos" distinct from "processing";
 *  - the moderation tab switcher (`toolbarLeading`) survives the empty state, so
 *    the owner can still reach the Pending queue.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // biome-ignore lint/performance/noImgElement: plain <img> stub for next/image in tests
    return <img src={src} alt={alt} />;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/app/[lang]/dashboard/photographer/events/[id]/actions', () => ({
  getPhotoDownloadUrlAction: vi.fn(),
  loadMoreOwnerEventPhotos: vi.fn(),
}));

vi.mock('@/app/[lang]/dashboard/photographer/events/[id]/edit/actions', () => ({
  deletePhotoAction: vi.fn(),
}));

import { Images } from 'lucide-react';
import { EventPhotoAlbum } from '@/app/[lang]/dashboard/photographer/events/[id]/event-photo-album';
import { PhotosEmptyState } from '@/components/photos-empty-state';
import en from '@/dictionaries/en.json';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

const emptyState = (
  <PhotosEmptyState
    icon={Images}
    title={en.events.photosEmptyTitle}
    description={en.events.photosEmptyDescription}
    action={{
      href: '/en/dashboard/photographer/events/evt-1/edit',
      label: en.events.photosEmptyCta,
    }}
  />
);

function renderAlbum(props: { totalCount: number; toolbarLeading?: React.ReactNode }) {
  return render(
    <TranslationsProvider translations={en.events}>
      <EventPhotoAlbum
        eventId="evt-1"
        items={[]}
        imageUnavailableLabel="No preview"
        emptyState={emptyState}
        loadMoreLabel="Load more"
        loadMoreErrorLabel="Could not load more"
        {...props}
      />
    </TranslationsProvider>,
  );
}

afterEach(cleanup);

describe('EventPhotoAlbum empty state (T-208)', () => {
  it('renders the empty state with an upload CTA when the event has no photos', () => {
    renderAlbum({ totalCount: 0 });

    expect(screen.getByText(en.events.photosEmptyTitle)).toBeTruthy();
    expect(screen.getByText(en.events.photosEmptyDescription)).toBeTruthy();

    const cta = screen.getByRole('link', { name: en.events.photosEmptyCta });
    expect(cta.getAttribute('href')).toBe('/en/dashboard/photographer/events/evt-1/edit');
  });

  it('does not render the empty state while uploads are still being validated', () => {
    // No items on this page yet, but the event's non-rejected total is 2 — those
    // photos exist and are processing, which `PhotosProcessingNotice` explains.
    renderAlbum({ totalCount: 2 });

    expect(screen.queryByText(en.events.photosEmptyTitle)).toBeNull();
  });

  it('keeps the moderation tab switcher reachable from the empty state', () => {
    renderAlbum({ totalCount: 0, toolbarLeading: <button type="button">Pending (0)</button> });

    expect(screen.getByText(en.events.photosEmptyTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pending (0)' })).toBeTruthy();
    // Nothing to select in an empty grid.
    expect(screen.queryByRole('button', { name: en.events.selectButton })).toBeNull();
  });
});

describe('PendingPhotosTab empty state copy (T-208)', () => {
  it('ships a description alongside the heading in both dictionaries', async () => {
    const es = (await import('@/dictionaries/es.json')).default;

    expect(en.collaborativeEvent.pendingEmptyDescription.length).toBeGreaterThan(0);
    expect(es.collaborativeEvent.pendingEmptyDescription.length).toBeGreaterThan(0);
    expect(es.events.photosEmptyCta.length).toBeGreaterThan(0);
  });
});
