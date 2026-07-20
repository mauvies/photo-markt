import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-168: the public event photo viewer's "View cart" toast
 * action navigated via `window.location.href = cartHref`, where `cartHref` was a
 * bare path (`/dashboard/talent/cart` or `/cart`). A full-page nav to a
 * locale-less path lets the middleware re-detect the locale from accept-language
 * and flip the language. The `locale` prop is already available, so `cartHref`
 * must be built through `localizedPath(locale, …)`.
 *
 * The sweep of T-161 missed this because the target is held in a variable, not
 * an inline href/router.push the grep matched — a source-level guard (T-149/
 * T-161 pattern) pins the locale prefix. Fails before the fix, passes after.
 */

const source = readFileSync(
  resolve(process.cwd(), 'src/app/[lang]/events/[shareCode]/public-event-photo-viewer.tsx'),
  'utf8',
);

describe('public event viewer cart toast href locale (T-168)', () => {
  it('builds cartHref through localizedPath with the active locale', () => {
    expect(source).toContain("import { localizedPath } from '@/lib/i18n/localized-path';");
    expect(source).toContain(
      "const cartHref = localizedPath(locale, isAuthenticated ? '/dashboard/talent/cart' : '/cart');",
    );
  });

  it('no longer assigns a bare (locale-less) path to cartHref', () => {
    expect(source).not.toContain(
      "const cartHref = isAuthenticated ? '/dashboard/talent/cart' : '/cart';",
    );
  });
});
