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
