import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-187: the public event photo viewer's "View cart" toast
 * action navigated via `window.location.href = cartHref` — a hard, full-document
 * reload. That remounts the shared `[lang]/layout.tsx` Nav, resetting
 * `useAuthUser()` to `undefined` (flashing the auth skeleton) and re-hydrating
 * the guest cart, for no gain: the dynamic cart page re-renders on soft nav and
 * the guest cart provider stays mounted with its already-updated count.
 *
 * The fix navigates with a SOFT `router.push(cartHref)` so the Nav instance is
 * preserved (no skeleton flash, no reload). Source-level guard (T-168/T-161
 * pattern) since the navigation is inside a toast callback held in a variable.
 * Fails before the fix, passes after.
 */

const source = readFileSync(
  resolve(process.cwd(), 'src/app/[lang]/events/[shareCode]/public-event-photo-viewer.tsx'),
  'utf8',
);

describe('public event viewer cart toast soft navigation (T-187)', () => {
  it('navigates the "View cart" toast action with a soft router.push', () => {
    expect(source).toContain('router.push(cartHref)');
  });

  it('no longer hard-navigates to the cart via window.location.href', () => {
    expect(source).not.toContain('window.location.href = cartHref');
  });
});
