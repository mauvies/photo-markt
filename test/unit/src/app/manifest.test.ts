import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';

/**
 * T-201 regression: the PWA manifest was a static `public/manifest.json` linked
 * by hand from `metadata.manifest` in `src/app/layout.tsx`. It is now the
 * `src/app/manifest.ts` file convention, served at `/manifest.webmanifest`.
 *
 * The source-level guards matter as much as the shape assertions: deleting the
 * JSON while leaving `manifest: '/manifest.json'` in the layout would ship a
 * `<link rel="manifest">` 404 on every page, and nothing else in the suite
 * would notice.
 */

const PUBLIC_DIR = join(process.cwd(), 'public');
const ROOT_LAYOUT = join(process.cwd(), 'src/app/layout.tsx');

describe('PWA manifest route (T-201)', () => {
  it('declares the identity and install fields', () => {
    expect(manifest()).toMatchObject({
      name: 'Photo Markt',
      short_name: 'Photo Markt',
      description: 'Find yourself in every photo',
      start_url: '/?source=pwa',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffffff',
    });
  });

  it('keeps orientation: portrait carried over from public/manifest.json', () => {
    // Declared decision, not an accident: the config in the ticket omitted it,
    // and dropping it would change how the installed PWA opens.
    expect(manifest().orientation).toBe('portrait');
  });

  it('ships both icon sizes with the right purposes, and the files exist', () => {
    const icons = manifest().icons ?? [];
    expect(icons).toEqual([
      {
        src: '/favicon/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/favicon/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ]);

    // A manifest whose icons 404 installs without an icon — the failure is
    // silent in every unit test that only reads the object.
    for (const icon of icons) {
      expect(existsSync(join(PUBLIC_DIR, icon.src)), `${icon.src} must exist in public/`).toBe(
        true,
      );
    }
  });

  it('no longer serves a static manifest from public/', () => {
    // Both were manifests: manifest.json is the one this route replaces, and
    // site.webmanifest was an orphan with empty name/short_name and icons
    // pointing at /android-chrome-*.png, which never existed at the root.
    expect(existsSync(join(PUBLIC_DIR, 'manifest.json'))).toBe(false);
    expect(existsSync(join(PUBLIC_DIR, 'site.webmanifest'))).toBe(false);
  });

  it('leaves the <link rel="manifest"> to Next instead of pointing at a dead path', () => {
    const source = readFileSync(ROOT_LAYOUT, 'utf8');
    expect(source).not.toMatch(/manifest:\s*['"]/);
    expect(source).not.toContain('/manifest.json');
  });
});
