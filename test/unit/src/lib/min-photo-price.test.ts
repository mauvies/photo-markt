import { describe, expect, it } from 'vitest';
import {
  formatMinPhotoPrice,
  getMinPhotoPriceCentsFromError,
  isMinPhotoPriceError,
  MIN_PHOTO_PRICE_ERROR_PREFIX,
  minPhotoPriceErrorMessage,
  minPhotoPriceMessage,
} from '@/lib/min-photo-price';

/**
 * T-195: the price floor is rejected server-side, but server actions have no
 * dictionary — the amount travels to the client inside the error message and is
 * localized there. These guard that round trip.
 */
describe('min-photo-price error channel', () => {
  it('round-trips the floor through the message', () => {
    const message = minPhotoPriceErrorMessage(150);
    expect(message).toBe('MIN_PHOTO_PRICE:150');
    expect(getMinPhotoPriceCentsFromError(new Error(message))).toBe(150);
  });

  it('survives the server-action boundary reducing the error to a plain Error', () => {
    // React preserves `.message` but not a custom `.name` or extra fields —
    // which is exactly why the amount is encoded in the message.
    const serialized = new Error(minPhotoPriceErrorMessage(299));
    expect(isMinPhotoPriceError(serialized)).toBe(true);
    expect(getMinPhotoPriceCentsFromError(serialized)).toBe(299);
  });

  it('accepts a raw string message', () => {
    expect(getMinPhotoPriceCentsFromError(`${MIN_PHOTO_PRICE_ERROR_PREFIX}75`)).toBe(75);
  });

  it('recognises a floor of 0', () => {
    expect(getMinPhotoPriceCentsFromError(new Error('MIN_PHOTO_PRICE:0'))).toBe(0);
  });

  it('ignores unrelated errors so callers fall through to their generic handler', () => {
    expect(isMinPhotoPriceError(new Error('Name is required.'))).toBe(false);
    expect(isMinPhotoPriceError(new Error('PLAN_LIMIT:maxEvents'))).toBe(false);
    expect(isMinPhotoPriceError(null)).toBe(false);
    expect(isMinPhotoPriceError(undefined)).toBe(false);
    expect(isMinPhotoPriceError({ message: 'MIN_PHOTO_PRICE:150' })).toBe(false);
  });

  it('rejects a malformed payload rather than rendering "at least €NaN"', () => {
    expect(getMinPhotoPriceCentsFromError(new Error('MIN_PHOTO_PRICE:abc'))).toBe(null);
    expect(getMinPhotoPriceCentsFromError(new Error('MIN_PHOTO_PRICE:'))).toBe(null);
    expect(getMinPhotoPriceCentsFromError(new Error('MIN_PHOTO_PRICE:-50'))).toBe(null);
    expect(getMinPhotoPriceCentsFromError(new Error('MIN_PHOTO_PRICE:1.5'))).toBe(null);
  });
});

describe('formatMinPhotoPrice', () => {
  it('renders cents as a euro amount (T-193 currency)', () => {
    expect(formatMinPhotoPrice(150)).toBe('€1.50');
    expect(formatMinPhotoPrice(99)).toBe('€0.99');
    expect(formatMinPhotoPrice(1000)).toBe('€10.00');
  });
});

describe('minPhotoPriceMessage', () => {
  it('interpolates the floor into the localized template', () => {
    const err = new Error(minPhotoPriceErrorMessage(150));
    expect(minPhotoPriceMessage(err, 'Price per photo must be at least {min}.')).toBe(
      'Price per photo must be at least €1.50.',
    );
    expect(minPhotoPriceMessage(err, 'El precio por foto debe ser de al menos {min}.')).toBe(
      'El precio por foto debe ser de al menos €1.50.',
    );
  });

  it('returns null for an unrelated error', () => {
    expect(minPhotoPriceMessage(new Error('boom'), 'at least {min}')).toBe(null);
  });
});
