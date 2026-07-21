import { describe, expect, it } from 'vitest';
import {
  installStripeWarningFilter,
  isStripeAccountsV2Recommendation,
} from '@/lib/stripe/suppress-accounts-v2-warning';

const V2_NOTICE =
  'We recommend building your integration using Accounts v2. See https://docs.stripe.com/api/v2/core/accounts';

describe('isStripeAccountsV2Recommendation (T-164)', () => {
  it('matches the Accounts v2 recommendation with the Stripe warning type', () => {
    expect(isStripeAccountsV2Recommendation(V2_NOTICE, 'Stripe')).toBe(true);
    expect(isStripeAccountsV2Recommendation(new Error(V2_NOTICE), 'Stripe')).toBe(true);
  });

  it('does NOT match other Stripe warnings', () => {
    expect(isStripeAccountsV2Recommendation('Request metrics buffer is full', 'Stripe')).toBe(
      false,
    );
  });

  it('does NOT match the same text under a different (non-Stripe) type', () => {
    // Only Stripe-typed warnings are candidates — never swallow a foreign one.
    expect(isStripeAccountsV2Recommendation(V2_NOTICE, undefined)).toBe(false);
    expect(isStripeAccountsV2Recommendation(V2_NOTICE, 'DeprecationWarning')).toBe(false);
  });

  it('does not throw on a Stripe-typed payload without a string message', () => {
    // The patch is process-global, so a non-string / message-less payload must
    // be handled gracefully (returns false) rather than throw out of emitWarning.
    const weird = { foo: 'bar' } as unknown as Error;
    expect(() => isStripeAccountsV2Recommendation(weird, 'Stripe')).not.toThrow();
    expect(isStripeAccountsV2Recommendation(weird, 'Stripe')).toBe(false);
  });
});

describe('installStripeWarningFilter (T-164)', () => {
  const INSTALLED_FLAG = Symbol.for('photomarkt.stripeWarningFilterInstalled');

  it('drops only the Accounts v2 notice and forwards every other warning', () => {
    // Hermetic: capture and fully restore the real global state. `config.ts` may
    // have already installed the filter during the suite, so clear the
    // idempotency flag to force a fresh install that wraps OUR capturing fake.
    const realEmit = process.emitWarning;
    const hadFlag = Reflect.get(process, INSTALLED_FLAG) === true;
    Reflect.deleteProperty(process, INSTALLED_FLAG);

    const forwarded: string[] = [];
    process.emitWarning = ((warning: string | Error) => {
      forwarded.push(typeof warning === 'string' ? warning : warning.message);
    }) as typeof process.emitWarning;

    try {
      installStripeWarningFilter();

      process.emitWarning(V2_NOTICE, 'Stripe'); // suppressed
      process.emitWarning('Some other Stripe warning', 'Stripe'); // forwarded
      process.emitWarning('a generic node warning'); // forwarded

      expect(forwarded).not.toContain(V2_NOTICE);
      expect(forwarded).toContain('Some other Stripe warning');
      expect(forwarded).toContain('a generic node warning');
    } finally {
      process.emitWarning = realEmit;
      if (hadFlag) Reflect.set(process, INSTALLED_FLAG, true);
      else Reflect.deleteProperty(process, INSTALLED_FLAG);
    }
  });

  it('is idempotent — a second install does not double-wrap', () => {
    const realEmit = process.emitWarning;
    const hadFlag = Reflect.get(process, INSTALLED_FLAG) === true;
    Reflect.deleteProperty(process, INSTALLED_FLAG);

    let calls = 0;
    process.emitWarning = ((warning: string | Error) => {
      void warning;
      calls += 1;
    }) as typeof process.emitWarning;

    try {
      installStripeWarningFilter();
      installStripeWarningFilter(); // no-op — flag already set
      process.emitWarning('a generic node warning');
      // Exactly one pass-through to the underlying impl (not stacked).
      expect(calls).toBe(1);
    } finally {
      process.emitWarning = realEmit;
      if (hadFlag) Reflect.set(process, INSTALLED_FLAG, true);
      else Reflect.deleteProperty(process, INSTALLED_FLAG);
    }
  });
});
