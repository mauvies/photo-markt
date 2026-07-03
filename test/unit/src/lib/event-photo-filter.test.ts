import { describe, expect, it } from 'vitest';
import { bibSearchEmptyKind, filterEventPhotos } from '@/lib/event-photo-filter';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('filterEventPhotos', () => {
  it('returns everything with the "all" filter and no bib search', () => {
    expect(
      filterEventPhotos(items, { filter: 'all', myPhotoIds: new Set(), bibMatchedIds: null }),
    ).toEqual(items);
  });

  it('restricts to "mine" when the filter is set', () => {
    expect(
      filterEventPhotos(items, { filter: 'mine', myPhotoIds: new Set(['b']), bibMatchedIds: null }),
    ).toEqual([{ id: 'b' }]);
  });

  // Regression (T-069): the talent viewer ignored bib matches entirely.
  it('restricts to bib-matched ids when a bib search is active', () => {
    expect(
      filterEventPhotos(items, { filter: 'all', myPhotoIds: new Set(), bibMatchedIds: ['a', 'c'] }),
    ).toEqual([{ id: 'a' }, { id: 'c' }]);
  });

  it('composes the "mine" filter with a bib search (intersection)', () => {
    expect(
      filterEventPhotos(items, {
        filter: 'mine',
        myPhotoIds: new Set(['a', 'b']),
        bibMatchedIds: ['b', 'c'],
      }),
    ).toEqual([{ id: 'b' }]);
  });

  it('returns nothing when a bib search matched no photos', () => {
    expect(
      filterEventPhotos(items, { filter: 'all', myPhotoIds: new Set(), bibMatchedIds: [] }),
    ).toEqual([]);
  });
});

describe('bibSearchEmptyKind', () => {
  it('is null when no bib search is active', () => {
    expect(bibSearchEmptyKind(null, 0, false)).toBeNull();
  });

  it('is null when the search has visible results', () => {
    expect(bibSearchEmptyKind(['a'], 1, true)).toBeNull();
  });

  it('is "pending" when empty and the event has no detected bibs yet', () => {
    expect(bibSearchEmptyKind([], 0, false)).toBe('pending');
  });

  it('is "no-match" when empty but the event does have detected bibs', () => {
    expect(bibSearchEmptyKind([], 0, true)).toBe('no-match');
  });
});
