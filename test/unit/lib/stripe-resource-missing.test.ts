/**
 * Unit tests for `isStripeResourceMissing`.
 *
 * This is what tells "the row points at something Stripe no longer has —
 * recover" apart from "Stripe is having a bad minute — retry". Getting it too
 * broad would swallow real failures into a silent recovery path; too narrow and
 * the photographer stays stuck on a paid plan they can neither change nor
 * cancel.
 */

import { describe, expect, it } from 'vitest';
import { isStripeResourceMissing } from '@/lib/stripe/resource-missing';

describe('isStripeResourceMissing', () => {
  it('recognises the Stripe 404 shape', () => {
    const error = Object.assign(new Error("No such subscription: 'sub_123'"), {
      type: 'StripeInvalidRequestError',
      code: 'resource_missing',
      statusCode: 404,
      param: 'id',
    });
    expect(isStripeResourceMissing(error)).toBe(true);
  });

  it('works on a plain object too (the error crosses module boundaries)', () => {
    expect(isStripeResourceMissing({ code: 'resource_missing' })).toBe(true);
  });

  it('does NOT swallow other Stripe failures', () => {
    // These must keep degrading to the controlled `checkout_failed` /
    // `subscription_failed` path — recovering from them would hide a real
    // outage or a misconfigured key behind a fresh checkout.
    for (const code of ['api_key_expired', 'rate_limit', 'card_declined', 'processing_error']) {
      expect(isStripeResourceMissing(Object.assign(new Error('x'), { code }))).toBe(false);
    }
  });

  it('is false for a generic error and for non-objects', () => {
    expect(isStripeResourceMissing(new Error('network down'))).toBe(false);
    expect(isStripeResourceMissing(null)).toBe(false);
    expect(isStripeResourceMissing(undefined)).toBe(false);
    expect(isStripeResourceMissing('resource_missing')).toBe(false);
    expect(isStripeResourceMissing(404)).toBe(false);
  });

  it('does not match a 404 that carries a different code', () => {
    expect(isStripeResourceMissing({ statusCode: 404, code: 'something_else' })).toBe(false);
  });
});
