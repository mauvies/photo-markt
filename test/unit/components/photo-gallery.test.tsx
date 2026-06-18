/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Download } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stub the underlying grid so PhotoGallery's own logic (selection, sections,
// toolbar, bulk actions) is tested without react-photo-album's layout pass.
// Each item renders as a button that toggles its selection.
vi.mock('@/components/photo-album-viewer', () => ({
  default: ({
    items,
    selectedIds,
    onToggleSelect,
  }: {
    items: Array<{ id: string }>;
    selectedIds?: string[];
    onToggleSelect?: (id: string) => void;
  }) => (
    <div data-testid="album">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          data-testid={`tile-${it.id}`}
          data-selected={Boolean(selectedIds?.includes(it.id))}
          onClick={() => onToggleSelect?.(it.id)}
        >
          {it.id}
        </button>
      ))}
    </div>
  ),
}));

import { PhotoGallery } from '@/components/photo-gallery';

afterEach(cleanup);

const labels = {
  select: 'Select',
  clear: 'Clear',
  countNone: 'No photos selected',
  countOne: '1 selected',
  countMany: '{n} selected',
  exitSelection: 'Exit',
};
const items = [
  { id: 'a', url: 'a.jpg' },
  { id: 'b', url: 'b.jpg' },
];
const galleryProps = { imageUnavailableLabel: 'Image unavailable' };

describe('PhotoGallery', () => {
  it('renders every item through the grid', () => {
    render(<PhotoGallery items={items} galleryProps={galleryProps} labels={labels} />);
    expect(screen.getByTestId('tile-a')).toBeTruthy();
    expect(screen.getByTestId('tile-b')).toBeTruthy();
  });

  it('enters selection mode via the Select button', () => {
    render(<PhotoGallery items={items} galleryProps={galleryProps} labels={labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.getByText('No photos selected')).toBeTruthy();
  });

  it('exits selection mode via the X button, returning to the Select toolbar', () => {
    render(<PhotoGallery items={items} galleryProps={galleryProps} labels={labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.getByText('No photos selected')).toBeTruthy();

    // The same sticky toolbar holds the exit (X); clicking it returns to idle.
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(screen.queryByText('No photos selected')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
  });

  it('runs a bulk action with the selected ids', () => {
    const onRun = vi.fn();
    render(
      <PhotoGallery
        items={items}
        galleryProps={galleryProps}
        labels={labels}
        bulkActions={[{ key: 'dl', label: 'Download', icon: Download, onRun }]}
      />,
    );
    fireEvent.click(screen.getByTestId('tile-a'));
    fireEvent.click(screen.getByTestId('tile-b'));
    expect(screen.getByText('2 selected')).toBeTruthy();

    // Bulk actions render twice (desktop inline + mobile bottom bar); CSS shows
    // one. Either fires the same handler.
    fireEvent.click(screen.getAllByRole('button', { name: 'Download' })[0]);
    expect(onRun).toHaveBeenCalledWith(['a', 'b']);
  });

  it('shares one selection set across sections (face-search buckets)', () => {
    const onRun = vi.fn();
    render(
      <PhotoGallery
        sections={[
          { key: 's1', items: [{ id: 'a', url: '' }] },
          { key: 's2', items: [{ id: 'b', url: '' }] },
        ]}
        galleryProps={galleryProps}
        labels={labels}
        bulkActions={[{ key: 'dl', label: 'Download', icon: Download, onRun }]}
      />,
    );
    fireEvent.click(screen.getByTestId('tile-a'));
    fireEvent.click(screen.getByTestId('tile-b'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Download' })[0]);
    expect(onRun).toHaveBeenCalledWith(['a', 'b']);
  });

  it('renders bulk actions both inline (desktop) and in the bottom bar (mobile)', () => {
    render(
      <PhotoGallery
        items={items}
        galleryProps={galleryProps}
        labels={labels}
        bulkActions={[{ key: 'dl', label: 'Download', icon: Download, onRun: vi.fn() }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    // The inline toolbar (desktop) and the fixed bottom bar (mobile) each render
    // the action; CSS hides the one that doesn't apply to the viewport.
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(2);
  });

  it('renders the empty state and no toolbar when there are no photos', () => {
    render(
      <PhotoGallery
        items={[]}
        galleryProps={galleryProps}
        labels={labels}
        emptyState={<div>No photos</div>}
      />,
    );
    expect(screen.getByText('No photos')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });

  it('omits the Select button when selectable is false', () => {
    render(
      <PhotoGallery items={items} galleryProps={galleryProps} labels={labels} selectable={false} />,
    );
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });
});
