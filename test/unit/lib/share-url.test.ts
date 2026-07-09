/**
 * T-082: extracted from the inline `handleShare` in `photo-detail-modal.tsx`
 * so it can be reused by the event Share icon. Web Share API when available,
 * clipboard fallback otherwise — behavior must stay identical to the inline
 * version it replaces.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareUrl } from '@/lib/share-url';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shareUrl', () => {
  it('uses navigator.share when available', () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });

    shareUrl('Marathon 2026', 'https://example.com/events/marathon-2026');

    expect(share).toHaveBeenCalledWith({
      title: 'Marathon 2026',
      url: 'https://example.com/events/marathon-2026',
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when navigator.share rejects', async () => {
    const share = vi.fn().mockRejectedValue(new Error('cancelled'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });

    shareUrl('Marathon 2026', 'https://example.com/events/marathon-2026');

    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://example.com/events/marathon-2026'),
    );
  });

  it('falls back to the clipboard when the Web Share API is unavailable', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    shareUrl('Marathon 2026', 'https://example.com/events/marathon-2026');

    expect(writeText).toHaveBeenCalledWith('https://example.com/events/marathon-2026');
  });
});
