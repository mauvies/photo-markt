/**
 * Unit tests for `resolvePhotoCta` — the primary-CTA derivation for the
 * two-panel photo-detail modal (T-066). The modal must reuse the viewer's
 * existing action flags, not hardcode the decision, so this pins the matrix.
 */

import { describe, expect, it } from 'vitest';
import { resolvePhotoCta } from '@/lib/photo-detail-cta';

describe('resolvePhotoCta', () => {
  it('offers add-to-cart for a paid photo not yet purchased', () => {
    expect(
      resolvePhotoCta({
        showAddToCart: true,
        showDownload: true,
        isDownloadable: false,
        isInCart: false,
      }),
    ).toBe('add-to-cart');
  });

  it('shows the in-cart state when the photo is already in the cart', () => {
    expect(
      resolvePhotoCta({
        showAddToCart: true,
        showDownload: true,
        isDownloadable: false,
        isInCart: true,
      }),
    ).toBe('in-cart');
  });

  it('offers download for an owned/purchased photo (download wins over cart)', () => {
    expect(
      resolvePhotoCta({
        showAddToCart: true,
        showDownload: true,
        isDownloadable: true,
        isInCart: false,
      }),
    ).toBe('download');
  });

  it('offers add-to-cart for a guest on a paid event (no download offered)', () => {
    expect(
      resolvePhotoCta({
        showAddToCart: true,
        showDownload: false,
        isDownloadable: false,
        isInCart: false,
      }),
    ).toBe('add-to-cart');
  });

  it('returns unavailable when nothing is actionable', () => {
    expect(
      resolvePhotoCta({
        showAddToCart: false,
        showDownload: false,
        isDownloadable: false,
        isInCart: false,
      }),
    ).toBe('unavailable');
  });
});
