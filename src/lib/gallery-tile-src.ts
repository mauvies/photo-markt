/**
 * Resolve the image source for a gallery grid tile (T-125).
 *
 * Precedence: the 400px `small` thumbnail, then the 800px `medium`, then the
 * full `url` fallback. Tiles render at ~180–280px, so the `small` variant
 * (~31 KB avg) covers every breakpoint — including mobile retina — while the
 * `medium` (~104 KB avg) ships ~3.4× the bytes a tile needs. The fallbacks keep
 * a photo whose thumbnails haven't baked (or a surface that doesn't thread
 * `thumbSmall`) on its current source, so the switch is a strict improvement
 * with no regression. The lightbox / detail modal open `medium`/full instead —
 * this is only for the grid tile.
 */
export function resolveGalleryTileSrc(item: {
  thumbSmall?: string;
  thumbMedium?: string;
  url: string;
}): string {
  return item.thumbSmall ?? item.thumbMedium ?? item.url;
}
