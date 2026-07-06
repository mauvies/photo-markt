/**
 * Compute the visible photos for an event gallery viewer, composing the
 * "All / My photos" filter with an active bib-number search.
 *
 * Shared by the public viewer (`public-event-photo-viewer.tsx`) and the
 * talent-dashboard viewer (`event-photo-viewer.tsx`) so both apply bib filtering
 * identically. The talent viewer previously ignored `bibMatchedIds`, so its grid
 * never filtered on a bib search (T-069).
 *
 * @param bibMatchedIds `null` = no bib search active (show everything the
 *   'mine' filter allows); `[]` = searched with no matches (show nothing);
 *   `[...]` = restrict to the matched ids.
 */
export function filterEventPhotos<T extends { id: string }>(
  items: T[],
  opts: {
    filter: 'all' | 'mine';
    myPhotoIds: Set<string>;
    bibMatchedIds: string[] | null;
  },
): T[] {
  let result = opts.filter === 'mine' ? items.filter((i) => opts.myPhotoIds.has(i.id)) : items;
  if (opts.bibMatchedIds !== null) {
    const bibSet = new Set(opts.bibMatchedIds);
    result = result.filter((i) => bibSet.has(i.id));
  }
  return result;
}

/**
 * Apply the grid's optimistic-delete filter and the "All / My photos" filter to
 * each paginated load-more page independently, dropping any page that ends up
 * empty. The result feeds the gallery as `itemBatches` so every load-more page
 * is laid out as its own segment — appending never re-flows earlier pages (no
 * scroll-jump). `bibMatchedIds` is intentionally not applied here: a bib search
 * renders its own complete signed set, not a filter over the paginated grid.
 *
 * Shared by all three event viewers (public, talent, photographer) so the
 * batching logic lives in one place.
 */
export function filterEventPhotoPages<T extends { id: string }>(
  pages: T[][],
  opts: {
    deletedIds: Set<string>;
    filter: 'all' | 'mine';
    myPhotoIds: Set<string>;
  },
): T[][] {
  return pages
    .map((page) =>
      filterEventPhotos(
        page.filter((item) => !opts.deletedIds.has(item.id)),
        { filter: opts.filter, myPhotoIds: opts.myPhotoIds, bibMatchedIds: null },
      ),
    )
    .filter((batch) => batch.length > 0);
}

/**
 * Which bib-search empty state to show, or `null` when no empty state applies.
 *
 * - `null` — no active bib search, or the search has visible results.
 * - `'pending'` — searched, nothing visible, and the event has no detected bibs
 *   at all yet (detection still processing or found none).
 * - `'no-match'` — searched, nothing visible, but the event does have detected
 *   bibs — so this specific number just didn't match.
 *
 * @param bibMatchedIds `null` = no bib search active.
 * @param visibleCount number of photos currently visible after filtering.
 * @param eventHasBibData whether the event has any detected bib numbers.
 */
export function bibSearchEmptyKind(
  bibMatchedIds: string[] | null,
  visibleCount: number,
  eventHasBibData: boolean,
): 'pending' | 'no-match' | null {
  if (bibMatchedIds === null) return null;
  if (visibleCount > 0) return null;
  return eventHasBibData ? 'no-match' : 'pending';
}
