/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { retryMock, discardMock, refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  retryMock: vi.fn(),
  discardMock: vi.fn(),
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/app/[lang]/dashboard/photographer/events/[id]/actions', () => ({
  retryFailedUploadsAction: retryMock,
  discardFailedUploadsAction: discardMock,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { FailedUploadsNotice } from '@/app/[lang]/dashboard/photographer/events/[id]/failed-uploads-notice';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// T-231: an upload the worker gave up on used to sit `upload_status='pending'`
// forever — invisible on the approved-only galleries, absent from the Pending
// moderation tab, and silently re-queued by the reconcile cron every 30 min.
// This notice is the ONLY surface where such a photo appears, so "renders
// nothing when healthy" and "offers both ways out" are the load-bearing bits.
const labels = {
  failedOne: "1 photo couldn't be processed and isn't visible to anyone.",
  failedMany: "{n} photos couldn't be processed and aren't visible to anyone.",
  retry: 'Try again',
  retrying: 'Retrying...',
  discard: 'Discard',
  discardTitle: 'Discard the photos that failed?',
  discardDescription: "{n} photo(s) will be permanently deleted. This can't be undone.",
  discardConfirm: 'Discard',
  discardCancel: 'Cancel',
  discardPending: 'Discarding...',
  retryToast: '{n} photo(s) queued again.',
  discardToast: '{n} photo(s) discarded.',
  error: 'Something went wrong.',
};

describe('FailedUploadsNotice (T-231)', () => {
  it('renders nothing when no upload failed', () => {
    const { container } = render(
      <FailedUploadsNotice eventId="e1" failedCount={0} labels={labels} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('reports the count and offers both recovery paths', () => {
    render(<FailedUploadsNotice eventId="e1" failedCount={3} labels={labels} />);
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain("3 photos couldn't be processed");
    expect(notice.textContent).not.toContain('{n}');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
  });

  it('uses the singular template for exactly one failed upload', () => {
    render(<FailedUploadsNotice eventId="e1" failedCount={1} labels={labels} />);
    expect(screen.getByRole('alert').textContent).toContain("1 photo couldn't be processed");
  });

  it('retries through the server action and refreshes on success', async () => {
    retryMock.mockResolvedValueOnce({ success: true, count: 2 });
    render(<FailedUploadsNotice eventId="event-42" failedCount={2} labels={labels} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(retryMock).toHaveBeenCalledWith('event-42'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('2 photo(s) queued again.'));
    expect(refreshMock).toHaveBeenCalled();
  });

  it('surfaces the action error instead of pretending the retry worked', async () => {
    retryMock.mockRejectedValueOnce(new Error('Too many retries.'));
    render(<FailedUploadsNotice eventId="event-42" failedCount={1} labels={labels} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Too many retries.'));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('confirms before discarding — a destructive action is never one click', async () => {
    discardMock.mockResolvedValueOnce({ success: true, count: 2 });
    render(<FailedUploadsNotice eventId="event-42" failedCount={2} labels={labels} />);

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(discardMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('2 photo(s) will be permanently deleted');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(discardMock).toHaveBeenCalledWith('event-42'));
  });
});
