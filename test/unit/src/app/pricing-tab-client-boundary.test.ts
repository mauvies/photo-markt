import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for a runtime-only failure found while reviewing T-203.
 *
 * `EventPricingTab` shipped without `'use client'` and CALLED `buttonVariants()`
 * — a function exported from a client module (`components/ui/button`). A Server
 * Component may render a client component but cannot invoke a client function,
 * so the tab threw on render:
 *
 *   "Attempted to call buttonVariants() from the server but buttonVariants is
 *    on the client."
 *
 * Neither `pnpm build` nor the test suite caught it: the module compiles fine
 * either way, and nothing rendered that tab. Hence a source-level guard — the
 * same shape as the other boundary guards in this suite.
 *
 * The rule: any component that calls `buttonVariants` (or `cn` over it) must be
 * a client component. `EventInfoCard`, whose header/Edit-link pattern the pricing
 * tab mirrors, has always been one for this reason.
 */

const root = process.cwd();

const CLIENT_CALLERS = [
  'src/app/[lang]/dashboard/photographer/events/[id]/event-pricing-tab.tsx',
  // The card it was modelled on — pinned too, so nobody "cleans up" its
  // directive and reintroduces the same failure one file over.
  'src/app/[lang]/dashboard/photographer/events/[id]/event-info-card.tsx',
];

describe('client-boundary guard for buttonVariants callers', () => {
  for (const path of CLIENT_CALLERS) {
    it(`${path} declares 'use client'`, () => {
      const source = readFileSync(resolve(root, path), 'utf8');
      expect(source).toContain('buttonVariants');
      // The directive must be the first statement, before any import.
      const firstCode = source
        .split('\n')
        .map((line) => line.trim())
        .find(
          (line) =>
            line !== '' &&
            !line.startsWith('//') &&
            !line.startsWith('*') &&
            !line.startsWith('/*'),
        );
      expect(firstCode).toBe("'use client';");
    });
  }
});
