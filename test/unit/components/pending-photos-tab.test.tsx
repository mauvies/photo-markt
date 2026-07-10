/** @vitest-environment happy-dom */
/**
 * T-109 — pending-queue moderation UI.
 *
 * Regression: reject must go through the app's standard confirmation dialog
 * (an AlertDialog), NOT the native `window.confirm()` the old tab used. Also
 * covers the new batch actions ("Approve all" and selection-based reject).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // biome-ignore lint/performance/noImgElement: plain <img> stub for next/image in tests
    return <img src={src} alt={alt} />;
  },
}));

const approve = vi.fn(async (_ids: string[], _eventId: string) => ({
  success: true as const,
  count: 1,
}));
const reject = vi.fn(async (_ids: string[], _eventId: string) => ({
  success: true as const,
  count: 1,
}));

vi.mock('@/app/[lang]/dashboard/photographer/events/[id]/actions', () => ({
  approvePendingPhotosAction: (ids: string[], eventId: string) => approve(ids, eventId),
  rejectPendingPhotosAction: (ids: string[], eventId: string) => reject(ids, eventId),
}));

import { PendingPhotosTab } from '@/app/[lang]/dashboard/photographer/events/[id]/pending-photos-tab';

const labels = {
  empty: 'No pending photos to review.',
  approveAria: 'Approve photo',
  rejectAria: 'Reject photo',
  select: 'Select',
  exitSelection: 'Exit selection',
  countOne: '1 selected',
  countMany: '{n} selected',
  approveAll: 'Approve all',
  approveSelected: 'Approve',
  rejectSelected: 'Reject',
  rejectConfirmTitle: 'Reject photo?',
  rejectConfirmTitleMany: 'Reject {n} photos?',
  rejectConfirmDescription: 'This photo will be deleted permanently. This cannot be undone.',
  rejectConfirmDescriptionMany:
    'These {n} photos will be deleted permanently. This cannot be undone.',
  rejectConfirmAction: 'Reject',
  rejectConfirmCancel: 'Cancel',
  rejectConfirmPending: 'Rejecting…',
  approveSuccessOne: 'Photo approved.',
  approveSuccessMany: '{n} photos approved.',
  rejectSuccessOne: 'Photo rejected.',
  rejectSuccessMany: '{n} photos rejected.',
  actionError: 'Something went wrong. Please try again.',
};

const photos = [
  { id: 'p1', url: '/p1.jpg', uploaderLabel: 'Guest A' },
  { id: 'p2', url: '/p2.jpg', uploaderLabel: 'Guest B' },
];

afterEach(() => {
  cleanup();
  approve.mockClear();
  reject.mockClear();
});

describe('PendingPhotosTab', () => {
  it('opens the confirmation dialog on reject instead of window.confirm()', () => {
    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy;

    render(<PendingPhotosTab eventId="e1" photos={photos} labels={labels} />);

    // Per-tile reject buttons (accessible name = rejectAria).
    const rejectButtons = screen.getAllByRole('button', { name: 'Reject photo' });
    fireEvent.click(rejectButtons[0]);

    // Standard AlertDialog is shown, native confirm is never called.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Reject photo?')).toBeTruthy();
  });

  it('rejects a single photo through the dialog confirm button', async () => {
    render(<PendingPhotosTab eventId="e1" photos={photos} labels={labels} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Reject photo' })[0]);
    const dialog = screen.getByRole('alertdialog');
    const confirm = screen.getAllByText('Reject').find((el) => dialog.contains(el));
    fireEvent.click(confirm as HTMLElement);

    await vi.waitFor(() => expect(reject).toHaveBeenCalledWith(['p1'], 'e1'));
  });

  it('approves every visible photo via "Approve all"', async () => {
    render(<PendingPhotosTab eventId="e1" photos={photos} labels={labels} />);

    fireEvent.click(screen.getByText('Approve all'));

    await vi.waitFor(() => expect(approve).toHaveBeenCalledWith(['p1', 'p2'], 'e1'));
  });

  it('batch-rejects the current selection', () => {
    render(<PendingPhotosTab eventId="e1" photos={photos} labels={labels} />);

    // Enter selection mode, then pick both tiles.
    fireEvent.click(screen.getByText('Select'));
    const tiles = screen.getAllByRole('button', { pressed: false });
    fireEvent.click(tiles[0]);
    fireEvent.click(tiles[1]);

    expect(screen.getByText('2 selected')).toBeTruthy();

    // Bulk "Reject" (rendered in both the desktop toolbar and mobile bar).
    fireEvent.click(screen.getAllByText('Reject')[0]);
    expect(screen.getByText('Reject 2 photos?')).toBeTruthy();
  });
});
