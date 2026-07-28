/**
 * Unit tests for the typed checkout error mapping (`src/lib/checkout-error.ts`,
 * T-189).
 *
 * Every `CheckoutErrorCode` the cart Server Actions can return must map to a
 * key that exists in the `cart` translation namespace (both cart clients are
 * wrapped in `<TranslationsProvider translations={dict.cart}>`). A code with no
 * mapping would surface an untranslated/blank toast — the very opacity T-189
 * set out to fix.
 */

import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import { type CheckoutErrorCode, checkoutErrorMessageKey } from '@/lib/checkout-error';

const ALL_CODES: CheckoutErrorCode[] = [
  'photographer_not_connected',
  'items_unavailable',
  'rate_limited',
  'cart_empty',
];

describe('checkoutErrorMessageKey', () => {
  it('maps each code to a distinct cart-namespace key', () => {
    expect(checkoutErrorMessageKey('photographer_not_connected')).toBe(
      'checkoutPhotographerNotConnected',
    );
    expect(checkoutErrorMessageKey('items_unavailable')).toBe('itemsUnavailableRemoved');
    expect(checkoutErrorMessageKey('rate_limited')).toBe('checkoutRateLimited');
    expect(checkoutErrorMessageKey('cart_empty')).toBe('empty');
  });

  it('maps every code to a non-empty string present in BOTH dictionaries', () => {
    for (const code of ALL_CODES) {
      const key = checkoutErrorMessageKey(code);
      const enValue = (en.cart as Record<string, unknown>)[key];
      const esValue = (es.cart as Record<string, unknown>)[key];
      expect(typeof enValue, `en.cart.${key}`).toBe('string');
      expect((enValue as string).length).toBeGreaterThan(0);
      expect(typeof esValue, `es.cart.${key}`).toBe('string');
      expect((esValue as string).length).toBeGreaterThan(0);
    }
  });
});
