import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-196 regression guard: the guest success page must NOT count photos by
 * counting the Stripe session's line items.
 *
 * Once the buyer service fee is live the session carries an extra, non-photo
 * line item, so counting line items reports "4 photos" for a 3-photo order.
 * The count comes from `metadata.cart_count` instead — written by the checkout
 * action from the same validated set the webhook builds the order from.
 *
 * Source-level because the page is an async Server Component whose only
 * observable output here is the string it renders.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/app/[lang]/checkout/guest/success/page.tsx'),
  'utf8',
);

describe('guest checkout success page — photo count', () => {
  it('counts photos from the cart_count metadata', () => {
    expect(SOURCE).toContain('metadata?.cart_count');
  });

  it('does not count Stripe line items', () => {
    expect(SOURCE).not.toContain('line_items?.data.length');
  });

  it('no longer expands line_items — nothing on the page needs them', () => {
    expect(SOURCE).not.toContain("expand: ['line_items']");
  });

  it('falls back to 0 rather than NaN on a missing or malformed value', () => {
    // "You purchased NaN photos" would be worse than a plain 0.
    expect(SOURCE).toMatch(/Number\.parseInt\(session\.metadata\?\.cart_count \?\? '0', 10\)/);
    expect(SOURCE).toMatch(/Number\.isFinite\(photoCount\)/);
  });
});
