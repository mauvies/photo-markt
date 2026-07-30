/**
 * Reveal-gate tripwire for "Add all my photos" (T-204, guarding T-177).
 *
 * A reveal-gated event reveals its photos ONLY to a visitor who proved a face
 * match, and the gate's security property is "photo IDs never reach an unproven
 * visitor" — the byte routes are not gated, so the UUID is the secret. CLAUDE.md
 * states the standing consequence: any future feature that surfaces a gated
 * event's photo id breaks the gate.
 *
 * "Add all my photos" is exactly such a feature, and the difference between safe
 * and broken is one line — where its ids come from. Taking them from the
 * viewer's OWN match set (`faceSearch.matchedPhotos`, the server's response to
 * the visitor's search, which on a gated event IS the proven set the reveal token
 * was minted over) can surface nothing the visitor was not already shown. Taking
 * them from a fresh query for the event's photos would hand an unproven visitor
 * every id in the event.
 *
 * Both are one call away from each other and both compile, so this is pinned at
 * the source level rather than left to review.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../../..');

/** The two event viewers that render the face-search results grid. */
const VIEWERS = [
  'src/app/[lang]/events/[shareCode]/public-event-photo-viewer.tsx',
  'src/app/[lang]/dashboard/talent/events/[id]/event-photo-viewer.tsx',
];

/**
 * Server-side photo-listing calls that must never feed the "add all" set. Each
 * returns event photos without regard to what this visitor has proven.
 */
const FORBIDDEN_ID_SOURCES = [
  'getEventPhotosPublic',
  'getEventPhotoIds',
  'loadAllEventPhotos',
  'getProvenRevealIds',
];

describe('"add all my photos" takes its ids from the viewer\'s own match set', () => {
  for (const file of VIEWERS) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');

    it(`${file} derives the id list from faceSearch.matchedPhotos`, () => {
      // The id list feeding the bulk add is built from the match set, not a query.
      expect(source).toContain('faceSearch.matchedPhotos.map((p) => p.id)');
    });

    it(`${file} routes the ids through the existing bulk add-to-cart handler`, () => {
      // Reusing `handleBulkAddToCart` keeps the already-purchased and
      // already-in-cart filters — a separate path would silently lose them.
      expect(source).toContain('handleBulkAddToCart(faceMatchIds)');
    });

    for (const forbidden of FORBIDDEN_ID_SOURCES) {
      it(`${file} does not fetch event photo ids via ${forbidden}`, () => {
        expect(source).not.toContain(forbidden);
      });
    }
  }
});
