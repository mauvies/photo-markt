/**
 * Resolves the counts shown in the event gallery toolbar (T-104 / T-122).
 *
 * The count must reflect what's currently on screen. During a **bib search**
 * the grid shows only the matched photos, so the count is the number of
 * matches (split per "All / My photos" tab), NOT the event total. Otherwise
 * it's the server-computed event total (and the viewer's "mine" total).
 */
export function resolveGalleryCounts<T extends { id: string }>(opts: {
  /** Whether a bib-number search is active (grid shows only matches). */
  bibActive: boolean;
  /** The complete matched-photo set when a bib search is active. */
  matchedPhotos: T[];
  /** Photo ids that count as the viewer's own (for the "My photos" tab). */
  mineIds: Set<string>;
  /** Server event total, shown when no bib search is active. */
  eventTotal: number;
  /** The viewer's "mine" total, shown when no bib search is active. */
  mineTotal: number;
}): { all: number; mine: number } {
  if (!opts.bibActive) return { all: opts.eventTotal, mine: opts.mineTotal };
  let mine = 0;
  for (const p of opts.matchedPhotos) if (opts.mineIds.has(p.id)) mine += 1;
  return { all: opts.matchedPhotos.length, mine };
}
