import { describe, expect, it } from 'vitest';
import { type GuestCartItem, parseGuestCart } from '@/lib/guest-cart';

const valid: GuestCartItem = {
  photoId: 'photo-1',
  photographerId: 'photographer-1',
  eventId: 'event-1',
  eventName: 'Marathon',
  eventDate: '2026-05-01',
  unitPriceCents: 500,
  previewUrl: null,
};

// T-223: the provider's mount hydration and its cross-tab `storage` listener
// both go through this, so both agree on what a stored cart is. The value is
// user-writable and survives deploys — it must fail closed, never throw.
describe('parseGuestCart', () => {
  it('parses a stored cart', () => {
    expect(parseGuestCart(JSON.stringify([valid]))).toEqual([valid]);
  });

  it('returns an empty cart for null, an empty string and invalid JSON', () => {
    expect(parseGuestCart(null)).toEqual([]);
    expect(parseGuestCart('')).toEqual([]);
    expect(parseGuestCart('{not json')).toEqual([]);
  });

  it('returns an empty cart for a non-array payload', () => {
    // Reached `items` before T-223, then broke every consumer that maps over it.
    expect(parseGuestCart('{"photoId":"photo-1"}')).toEqual([]);
    expect(parseGuestCart('"photo-1"')).toEqual([]);
    expect(parseGuestCart('null')).toEqual([]);
  });

  it('drops entries that would poison the subtotal', () => {
    // A missing/non-numeric `unitPriceCents` turns `subtotalCents` into NaN, so
    // the cart would show "NaN €" rather than one wrong line.
    const raw = JSON.stringify([
      valid,
      { photoId: 'photo-2' },
      { photoId: 'photo-3', unitPriceCents: '700' },
      { unitPriceCents: 700 },
      null,
      'photo-4',
    ]);
    expect(parseGuestCart(raw)).toEqual([valid]);
  });

  it('keeps legacy items written before `eventShareCode` existed', () => {
    const { eventShareCode: _omitted, ...legacy } = { ...valid, eventShareCode: 'abc' };
    expect(parseGuestCart(JSON.stringify([legacy]))).toEqual([legacy]);
  });
});
