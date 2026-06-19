import { describe, expect, it } from 'vitest';
import { eventBulkActionKeys } from '@/lib/event-bulk-actions';

describe('eventBulkActionKeys', () => {
  it('omits download on a paid (watermarked) event — keeps add-to-cart (T-010)', () => {
    const keys = eventBulkActionKeys({
      canAddToCart: true,
      isFreeEvent: false,
      canDeleteOwnPhotos: false,
    });
    expect(keys).toContain('add-to-cart');
    expect(keys).not.toContain('download');
  });

  it('offers download on a free event', () => {
    const keys = eventBulkActionKeys({
      canAddToCart: false,
      isFreeEvent: true,
      canDeleteOwnPhotos: false,
    });
    expect(keys).toEqual(['download']);
  });

  it('adds delete only for owned-photo (collaborative) events', () => {
    expect(
      eventBulkActionKeys({ canAddToCart: true, isFreeEvent: false, canDeleteOwnPhotos: true }),
    ).toEqual(['add-to-cart', 'delete']);
  });
});
