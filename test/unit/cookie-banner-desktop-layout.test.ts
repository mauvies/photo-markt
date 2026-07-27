import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-188: the desktop cookie banner looked unbalanced — the
 * wide side-by-side bar (`sm:flex sm:items-center` + a `flex-1` text column)
 * left the description wrapping into a tall, narrow block while the short button
 * row floated mid-height beside it. The fix stacks text over a right-aligned
 * button row in a narrower centered card, so text and buttons never compete for
 * width.
 *
 * Source-level assertions (edit-event-price-field-layout / route-loading-skeletons
 * pattern): fail before the fix, pass after. The behavioural mobile-stacking +
 * positioning guarantees (T-169) are covered by cookie-consent.test.tsx.
 */

const source = readFileSync(
  resolve(process.cwd(), 'src/components/cookie-consent-banner.tsx'),
  'utf8',
);

describe('cookie banner desktop layout (T-188)', () => {
  it('drops the wide side-by-side bar in favour of a narrower stacked card', () => {
    // The old bar spread text and buttons across a wide row and stretched the
    // container to max-w-3xl.
    expect(source).not.toContain('sm:flex sm:items-center sm:gap-4');
    expect(source).not.toContain('flex-1 text-sm');
    expect(source).not.toContain('max-w-3xl');
    expect(source).toContain('max-w-lg');
  });

  it('right-aligns the button row under the text on desktop (still stacked on mobile)', () => {
    // Kept from T-169: column on mobile → row on desktop, full-width buttons on
    // mobile. New in T-188: the desktop row is aligned to the end.
    expect(source).toContain('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end');
    expect(source).toContain('w-full sm:w-auto');
  });
});
