import { describe, expect, it } from 'vitest';
import { eventBulkActionKeys, shouldShowBulkDownload } from '@/lib/event-bulk-actions';

describe('shouldShowBulkDownload (T-041)', () => {
  it('shows download on a free event', () => {
    expect(shouldShowBulkDownload(true, false)).toBe(true);
  });

  it('shows download on a paid event only when the viewer has purchased photos', () => {
    expect(shouldShowBulkDownload(false, true)).toBe(true);
    expect(shouldShowBulkDownload(false, false)).toBe(false);
  });
});

describe('eventBulkActionKeys', () => {
  it('omits download on a paid (watermarked) event with no purchases — keeps add-to-cart (T-010)', () => {
    const keys = eventBulkActionKeys({
      canAddToCart: true,
      isFreeEvent: false,
      hasPurchasedPhotos: false,
      canDeleteOwnPhotos: false,
    });
    expect(keys).toContain('add-to-cart');
    expect(keys).not.toContain('download');
  });

  it('offers download on a paid event once the viewer has purchased photos (T-041)', () => {
    const keys = eventBulkActionKeys({
      canAddToCart: true,
      isFreeEvent: false,
      hasPurchasedPhotos: true,
      canDeleteOwnPhotos: false,
    });
    expect(keys).toContain('download');
  });

  it('offers download on a free event', () => {
    const keys = eventBulkActionKeys({
      canAddToCart: false,
      isFreeEvent: true,
      hasPurchasedPhotos: false,
      canDeleteOwnPhotos: false,
    });
    expect(keys).toEqual(['download']);
  });

  it('adds delete only for owned-photo (collaborative) events', () => {
    expect(
      eventBulkActionKeys({
        canAddToCart: true,
        isFreeEvent: false,
        hasPurchasedPhotos: false,
        canDeleteOwnPhotos: true,
      }),
    ).toEqual(['add-to-cart', 'delete']);
  });
});
