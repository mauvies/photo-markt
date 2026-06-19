/**
 * Indices to keep mounted around `currentIndex` in the lightbox — the current
 * photo plus `radius` neighbours on each side, wrapping at both ends to mirror
 * the circular next/prev navigation. Deduplicated for galleries smaller than
 * the window. Rendering (and so preloading) this window makes in-window
 * navigation reveal an already-decoded image instead of a blank flash.
 */
export function getLightboxWindow(currentIndex: number, total: number, radius: number): number[] {
  if (total <= 0 || currentIndex < 0 || currentIndex >= total) return [];
  const indices = new Set<number>();
  for (let offset = -radius; offset <= radius; offset += 1) {
    indices.add((((currentIndex + offset) % total) + total) % total);
  }
  return [...indices];
}

/**
 * Signed slide-slot offset of `index` relative to `currentIndex` for the
 * carousel transform — `current * 100%` translateX. Returns the *shortest*
 * circular distance so a wrap-around neighbour (e.g. the last photo when the
 * first is shown) sits one slot to the left (-1), not `total-1` slots to the
 * right. Used to slide neighbours in attached to the outgoing photo.
 */
export function slideOffset(index: number, currentIndex: number, total: number): number {
  if (total <= 0) return 0;
  const raw = (((index - currentIndex) % total) + total) % total;
  return raw > total / 2 ? raw - total : raw;
}
