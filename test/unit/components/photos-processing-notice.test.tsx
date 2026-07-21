/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PhotosProcessingNotice } from '@/app/[lang]/dashboard/photographer/events/[id]/photos-processing-notice';

afterEach(cleanup);

// Regression (T-174): the solo-event dashboard grid mixes `approved` and
// still-`pending` uploads under a single "N photos" total. When the
// face-indexing worker hasn't promoted uploads to `approved` yet, that total
// silently disagreed with the public event page (approved-only) — the photog
// saw "35 photos" while the public page showed 0, reading as lost photos.
// This notice spells out the approved-vs-processing split so the gap is clear.
const labels = {
  processingOne:
    "1 of your photos is still processing and won't appear on your public event page until it's ready. {approved} of {total} are visible publicly now.",
  processingMany:
    "{pending} of your photos are still processing and won't appear on your public event page until they're ready. {approved} of {total} are visible publicly now.",
};

describe('PhotosProcessingNotice (T-174)', () => {
  it('reproduces the reported case: 35 pending / 0 approved spells out 0 of 35 public', () => {
    render(<PhotosProcessingNotice pendingCount={35} approvedCount={0} labels={labels} />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('35 of your photos are still processing');
    // Interpolates approved (0) and total (0 + 35 = 35) — the crux of the fix.
    expect(notice.textContent).toContain('0 of 35 are visible publicly now');
  });

  it('uses the singular template for exactly one pending photo', () => {
    render(<PhotosProcessingNotice pendingCount={1} approvedCount={9} labels={labels} />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('1 of your photos is still processing');
    expect(notice.textContent).toContain('9 of 10 are visible publicly now');
    // No leftover placeholders.
    expect(notice.textContent).not.toContain('{pending}');
    expect(notice.textContent).not.toContain('{approved}');
    expect(notice.textContent).not.toContain('{total}');
  });

  it('renders nothing when no photos are pending (all promoted / public)', () => {
    const { container } = render(
      <PhotosProcessingNotice pendingCount={0} approvedCount={12} labels={labels} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing for a negative delta (never a "-1 processing" glitch)', () => {
    const { container } = render(
      <PhotosProcessingNotice pendingCount={-1} approvedCount={5} labels={labels} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
