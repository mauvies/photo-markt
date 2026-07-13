/** @vitest-environment happy-dom */
/**
 * T-113 — the photographer moderation view's Approved/Pending switcher must sit
 * on the SAME toolbar row as the "Select" button (previously a separate row
 * above the panel). The switcher is passed as `toolbarLeading` into the active
 * panel, which renders it in its real `PhotoSelectionToolbar` leading slot.
 *
 * The heavy panels are mocked down to just the real toolbar so the layout — tab
 * triggers and "Select" in one row — is what's asserted, plus tab switching.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoSelectionToolbar } from '@/components/photo-selection-toolbar';

function toolbar(leading: React.ReactNode) {
  return (
    <PhotoSelectionToolbar
      isSelecting={false}
      countLabel=""
      selectLabel="Select"
      exitLabel="Exit"
      onStartSelecting={() => {}}
      onClear={() => {}}
      leading={leading}
    />
  );
}

vi.mock('@/app/[lang]/dashboard/photographer/events/[id]/event-photo-album', () => ({
  EventPhotoAlbum: ({ toolbarLeading }: { toolbarLeading?: React.ReactNode }) => (
    <div>
      <span>album-panel</span>
      {toolbar(toolbarLeading)}
    </div>
  ),
}));

vi.mock('@/app/[lang]/dashboard/photographer/events/[id]/pending-photos-tab', () => ({
  PendingPhotosTab: ({ toolbarLeading }: { toolbarLeading?: React.ReactNode }) => (
    <div>
      <span>pending-panel</span>
      {toolbar(toolbarLeading)}
    </div>
  ),
}));

import { EventModerationTabs } from '@/app/[lang]/dashboard/photographer/events/[id]/event-moderation-tabs';

const baseProps = {
  albumProps: {} as never,
  pendingProps: {} as never,
  approvedLabel: 'All photos',
  pendingLabelTemplate: 'Pending ({n})',
  approvedCount: 5,
  pendingCount: 2,
};

afterEach(cleanup);

describe('EventModerationTabs (T-113)', () => {
  it('renders the tab switcher (with counts) in the same toolbar row as "Select"', () => {
    render(<EventModerationTabs {...baseProps} />);

    const approvedTab = screen.getByRole('tab', { name: 'All photos (5)' });
    expect(screen.getByRole('tab', { name: 'Pending (2)' })).toBeTruthy();

    // The "Select" button and the tab live in the same toolbar row.
    const selectButton = screen.getByRole('button', { name: 'Select' });
    const row = selectButton.parentElement as HTMLElement;
    expect(row.contains(approvedTab)).toBe(true);
  });

  it('switches to the pending panel when the Pending tab is clicked (switcher stays)', () => {
    render(<EventModerationTabs {...baseProps} />);

    expect(screen.getByText('album-panel')).toBeTruthy();

    // Radix Tabs triggers activate on pointer/mouse-down, not `click`.
    const pendingTab = screen.getByRole('tab', { name: 'Pending (2)' });
    fireEvent.pointerDown(pendingTab, { button: 0, ctrlKey: false });
    fireEvent.mouseDown(pendingTab, { button: 0, ctrlKey: false });

    expect(screen.getByText('pending-panel')).toBeTruthy();
    expect(screen.queryByText('album-panel')).toBeNull();
    // Switcher is re-rendered inside the pending panel's toolbar.
    expect(screen.getByRole('tab', { name: 'All photos (5)' })).toBeTruthy();
  });
});
