/** @vitest-environment happy-dom */
/**
 * Regression (⚠️ commercial): the lightbox and the purchase modal shared
 * `photo.url` — the IMAGE. A recipient landed on bare bytes: no title, no
 * price, no "Add to cart", no way into the event. On a for-sale photo that is
 * a lost sale, and it hands a purchase-flow asset out on its own.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { buildPhotoShareUrl } from '@/lib/photo-share-url';

function setUrl(href: string) {
  window.history.replaceState(null, '', href);
}

beforeEach(() => setUrl('/'));

describe('buildPhotoShareUrl', () => {
  it('shares the current page with ?photo= set', () => {
    setUrl('/en/events/marathon-lyon-2026');
    expect(buildPhotoShareUrl('photo-1')).toBe(
      `${window.location.origin}/en/events/marathon-lyon-2026?photo=photo-1`,
    );
  });

  it('keeps a private event usable for the recipient — the share code is in the path', () => {
    // Private events resolve by share code (`/events/<CODE>`), so copying the
    // current URL is what carries the recipient's access.
    setUrl('/es/events/A1B2C3D4');
    const href = buildPhotoShareUrl('photo-9');
    expect(href).toContain('/es/events/A1B2C3D4');
    expect(href).toContain('photo=photo-9');
  });

  it('preserves every other query param already on the page', () => {
    setUrl('/en/events/ABC123?bib=451&foo=bar');
    const href = buildPhotoShareUrl('photo-2') as string;
    const params = new URL(href).searchParams;
    expect(params.get('bib')).toBe('451');
    expect(params.get('foo')).toBe('bar');
    expect(params.get('photo')).toBe('photo-2');
  });

  it('replaces a stale ?photo= rather than appending a second one', () => {
    setUrl('/en/events/ABC123?photo=old');
    const href = buildPhotoShareUrl('new') as string;
    expect(new URL(href).searchParams.getAll('photo')).toEqual(['new']);
  });

  it('uses the same param name the lightbox URL sync writes', () => {
    // `usePhotoLightboxUrl(items, 'photo')` — a divergence here means the link
    // opens the event page with nothing selected.
    setUrl('/en/events/ABC123');
    expect(buildPhotoShareUrl('p')).toContain('?photo=p');
  });
});
