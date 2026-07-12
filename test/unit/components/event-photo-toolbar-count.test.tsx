/** @vitest-environment happy-dom */
/**
 * T-104 — gallery toolbar photo count.
 *
 * Events WITH the "All / My photos" tabs integrate the count into each label
 * ("All photos (N)" / "My photos (N)"); events WITHOUT tabs get a standalone
 * "Photos (N)" label. The counts are props (the server-computed event total),
 * NOT derived from a loaded item list — so a paginated grid still shows the
 * whole-event total.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventPhotoCountLabel } from '@/components/event-photo-count-label';
import { EventPhotoFilterTabs } from '@/components/event-photo-filter-tabs';

afterEach(cleanup);

describe('EventPhotoFilterTabs counts (T-104)', () => {
  it('appends the per-tab count to each label when counts are provided', () => {
    render(
      <EventPhotoFilterTabs
        value="all"
        onValueChange={() => {}}
        allLabel="All photos"
        mineLabel="My photos"
        allCount={116}
        mineCount={12}
      />,
    );

    expect(screen.getByText('All photos (116)')).toBeTruthy();
    expect(screen.getByText('My photos (12)')).toBeTruthy();
  });

  it('renders a zero count rather than hiding it', () => {
    render(
      <EventPhotoFilterTabs
        value="all"
        onValueChange={() => {}}
        allLabel="All photos"
        mineLabel="My photos"
        allCount={116}
        mineCount={0}
      />,
    );

    expect(screen.getByText('My photos (0)')).toBeTruthy();
  });

  it('renders plain labels when no counts are given (unchanged pre-T-104 behavior)', () => {
    render(
      <EventPhotoFilterTabs
        value="all"
        onValueChange={() => {}}
        allLabel="All photos"
        mineLabel="My photos"
      />,
    );

    expect(screen.getByText('All photos')).toBeTruthy();
    expect(screen.getByText('My photos')).toBeTruthy();
    expect(screen.queryByText(/\(\d+\)/)).toBeNull();
  });

  it('still fires onValueChange when a tab is clicked', () => {
    const onValueChange = vi.fn();
    render(
      <EventPhotoFilterTabs
        value="all"
        onValueChange={onValueChange}
        allLabel="All photos"
        mineLabel="My photos"
        allCount={116}
        mineCount={12}
      />,
    );

    fireEvent.click(screen.getByText('My photos (12)'));
    expect(onValueChange).toHaveBeenCalledWith('mine');
  });
});

describe('EventPhotoCountLabel (T-104)', () => {
  it('renders the standalone count label for tab-less galleries', () => {
    render(<EventPhotoCountLabel label="Photos (116)" />);
    expect(screen.getByText('Photos (116)')).toBeTruthy();
  });
});
