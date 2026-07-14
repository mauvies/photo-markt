import { describe, expect, it } from 'vitest';
import { resolveGalleryCounts } from '@/lib/gallery-photo-count';

const photo = (id: string) => ({ id });

describe('resolveGalleryCounts (T-122)', () => {
  it('uses the event total when no bib search is active', () => {
    expect(
      resolveGalleryCounts({
        bibActive: false,
        matchedPhotos: [],
        mineIds: new Set(),
        eventTotal: 116,
        mineTotal: 12,
      }),
    ).toEqual({ all: 116, mine: 12 });
  });

  it('uses the number of bib matches (not the event total) when a search is active', () => {
    // The reported bug: a bib search matching 3 photos should read "Photos (3)".
    expect(
      resolveGalleryCounts({
        bibActive: true,
        matchedPhotos: [photo('a'), photo('b'), photo('c')],
        mineIds: new Set(),
        eventTotal: 116,
        mineTotal: 12,
      }),
    ).toMatchObject({ all: 3 });
  });

  it('splits the matched count per All/My tab during a bib search', () => {
    const result = resolveGalleryCounts({
      bibActive: true,
      matchedPhotos: [photo('a'), photo('b'), photo('c')],
      mineIds: new Set(['b']),
      eventTotal: 116,
      mineTotal: 12,
    });
    expect(result).toEqual({ all: 3, mine: 1 });
  });

  it('returns zero matches for an empty bib search (not the event total)', () => {
    expect(
      resolveGalleryCounts({
        bibActive: true,
        matchedPhotos: [],
        mineIds: new Set(),
        eventTotal: 116,
        mineTotal: 12,
      }),
    ).toEqual({ all: 0, mine: 0 });
  });
});
