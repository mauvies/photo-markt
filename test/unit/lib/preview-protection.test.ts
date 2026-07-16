/**
 * Unit tests for `needsProtectedPreview` (`src/lib/preview-protection.ts`) —
 * the shared T-131/T-133/T-136 predicate deciding whether a photo's pre-bake
 * fallback must route through the fail-closed /api/watermark/ route instead
 * of a direct signed full-res original.
 */

import { describe, expect, it } from 'vitest';
import { needsProtectedPreview } from '@/lib/preview-protection';

describe('needsProtectedPreview', () => {
  it('protects watermarked events regardless of price (T-131)', () => {
    expect(needsProtectedPreview({ watermark_enabled: true, price_per_photo: null })).toBe(true);
    expect(needsProtectedPreview({ watermark_enabled: true, price_per_photo: 0 })).toBe(true);
    expect(needsProtectedPreview({ watermark_enabled: true, price_per_photo: 10 })).toBe(true);
  });

  it('protects FOR-SALE events even without a visible watermark (T-133/T-136)', () => {
    expect(needsProtectedPreview({ watermark_enabled: false, price_per_photo: 10 })).toBe(true);
    expect(needsProtectedPreview({ watermark_enabled: false, price_per_photo: 1 })).toBe(true);
    // For-sale means any NON-NULL price — including 0, matching `isForSale`
    // and both download gates (all key on `price_per_photo !== null`). A
    // 0-priced event still shows the buy UI and denies downloads, so its
    // originals stay payment-gated.
    expect(needsProtectedPreview({ watermark_enabled: false, price_per_photo: 0 })).toBe(true);
  });

  it('leaves only a positively-known free (null price) AND un-watermarked event unprotected', () => {
    expect(needsProtectedPreview({ watermark_enabled: false, price_per_photo: null })).toBe(false);
  });

  it('fails closed on anything not positively confirmed free + un-watermarked', () => {
    // Missing event embed (RLS-hidden join, event_id NULL orphan).
    expect(needsProtectedPreview(null)).toBe(true);
    expect(needsProtectedPreview(undefined)).toBe(true);
    // Unknown watermark flag — never assume clean.
    expect(needsProtectedPreview({ watermark_enabled: null, price_per_photo: null })).toBe(true);
    // Unknown price (field never selected) — never assume free.
    expect(needsProtectedPreview({ watermark_enabled: false, price_per_photo: undefined })).toBe(
      true,
    );
    expect(needsProtectedPreview({ watermark_enabled: undefined, price_per_photo: 0 })).toBe(true);
  });
});
