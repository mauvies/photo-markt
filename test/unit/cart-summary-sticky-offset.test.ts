import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-158: the desktop cart summary panel ("Proceed to
 * checkout") was `sticky top-4`, so on scroll it anchored 1rem below the
 * viewport top — above where the sticky header (`--header-height` = 4.5rem)
 * ends — and slid partially behind the nav. It must instead anchor just below
 * the header using an offset derived from `--header-height`.
 *
 * Both cart surfaces (guest + authenticated) must use the same offset. These
 * assertions fail before the fix and pass after (source-level pattern, like
 * T-127/T-128).
 */

const root = process.cwd();

const SURFACES = [
  'src/app/[lang]/cart/guest-cart-content.tsx',
  'src/app/[lang]/dashboard/talent/cart/cart-content.tsx',
];

const STICKY_OFFSET = 'sticky top-[calc(var(--header-height)+1rem)]';

describe('cart summary sticky offset (T-158)', () => {
  for (const surface of SURFACES) {
    it(`anchors the summary below the nav via --header-height in ${surface}`, () => {
      const source = readFileSync(resolve(root, surface), 'utf8');
      expect(source).toContain(STICKY_OFFSET);
      // The old bug: the summary panel pinned at top-4 (1rem from the viewport),
      // overlapping the sticky header.
      expect(source).not.toContain('sticky top-4');
    });
  }
});
