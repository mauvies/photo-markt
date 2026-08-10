/**
 * The guest download page must ask Supabase for an attachment (T-245).
 *
 * The markup carries `<a … download>`, which reads like it is enough and is not:
 * the HTML `download` attribute is **ignored for cross-origin URLs**, and these
 * URLs point at Supabase Storage — a different origin from the app. So the
 * browser navigated to the image and the buyer, who had just paid, was left
 * saving it by hand from a raw storage URL.
 *
 * `createSignedUrl(path, ttl, { download })` sets `Content-Disposition:
 * attachment` on the response, which is honoured whatever the origin. Dropping
 * that third argument compiles, renders identically, and silently restores the
 * bug — so it is pinned here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../../..');
const PAGE = 'src/app/[lang]/download/[token]/page.tsx';

describe('guest download page', () => {
  const source = readFileSync(join(REPO_ROOT, PAGE), 'utf8');

  it('signs the URL with a download filename', () => {
    expect(source).toMatch(/createSignedUrl\([^)]*\{\s*download:/s);
  });

  it('never signs the originals without one', () => {
    // The bare two-argument form is exactly what shipped the bug.
    expect(source).not.toMatch(/createSignedUrl\(\s*photo\.original_url\s*,\s*\d+\s*\)/);
  });
});
