/**
 * Whether a `next/image` src should skip Vercel's image optimizer.
 *
 * Sources served from our own `/api/` routes (baked `/api/thumb` WebP
 * thumbnails, `/api/watermark` previews) are already sized, encoded and
 * immutable — re-optimizing them through `/_next/image` burns CPU and the Hobby
 * plan's transformation quota without saving egress (F-21, caching audit T-083).
 * `localhost` sources (local Supabase Storage in dev) also can't be reached by
 * the optimizer. Everything else (signed Supabase covers, avatars) still goes
 * through the optimizer, where it genuinely helps.
 *
 * Shared by the carousel, the gallery grid and event cards so the predicate
 * never diverges between them again.
 */
export function shouldSkipImageOptimization(src: string): boolean {
  return src.includes('/api/') || src.includes('localhost');
}
