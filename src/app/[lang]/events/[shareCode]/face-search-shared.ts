/**
 * Types + helpers shared between the `searchFacesInEvent` Server Action and
 * the client modal/wrapper that consume it. Lives in a non-`'use server'`
 * file because Next.js requires `'use server'` modules to export ONLY async
 * functions — sync helpers and runtime values (even type-only exports are
 * fine, but mixing them with `'use server'` is fragile across bundlers).
 */

import type { PublicPhotoAlbumItem } from './photo-album-item';

/**
 * Confidence buckets for the talent-side AI search. Thresholds match the
 * product spec — anything below 80 (AWS-side `FaceMatchThreshold`) is
 * already filtered out by `searchFacesByImage`.
 */
export type SearchMatchBucket = 'very-likely' | 'likely' | 'possibly';

export interface SearchFacesInEventResult {
  matches: Array<{
    photoId: string;
    similarity: number;
    bucket: SearchMatchBucket;
  }>;
  /**
   * The matched photos, already signed and complete — independent of the
   * paginated grid. The viewer buckets THESE (not the grid) so a match beyond
   * the loaded page still renders. Kept in lockstep with `matches`: every id in
   * `matches` has a corresponding item here, and vice versa.
   */
  matchedPhotos: PublicPhotoAlbumItem[];
  totalSearched: number;
  eventIndexingComplete: boolean;
  /**
   * Populated when AWS rejected the selfie itself (no face / multiple faces)
   * or when the event's collection is gone. The modal renders a localized
   * message for each value and stays open so the user can retry.
   */
  reason?: 'invalid-selfie' | 'collection-missing';
}

/**
 * Parseable message prefix on the rate-limit / degradation errors. Mirrors the
 * `PLAN_LIMIT:` pattern from `lib/plan-limits.ts` so the client can detect
 * the type from the message string alone (React strips custom Error
 * subclasses in production).
 *
 * Two distinct outcomes share the prefix:
 *   - `:exhausted`   — the per-(event, IP) hourly throttle (tier 1). Retryable
 *                      soon; the modal shows "too many searches, try later".
 *   - `:unavailable` — a cost breaker tripped (per-event or global daily cap,
 *                      T-034). The modal shows a dignified "temporarily
 *                      unavailable" — the user needn't know which breaker.
 */
export const FACE_SEARCH_RATE_LIMIT_PREFIX = 'RATE_LIMIT:face-search';
export const FACE_SEARCH_EXHAUSTED_MESSAGE = `${FACE_SEARCH_RATE_LIMIT_PREFIX}:exhausted`;
export const FACE_SEARCH_UNAVAILABLE_MESSAGE = `${FACE_SEARCH_RATE_LIMIT_PREFIX}:unavailable`;

/** Tier-1 per-IP throttle ("too many searches"). Excludes the breaker outcome. */
export function isFaceSearchRateLimitError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(FACE_SEARCH_EXHAUSTED_MESSAGE);
}

/** A cost breaker tripped — face search is temporarily unavailable (T-034). */
export function isFaceSearchUnavailableError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(FACE_SEARCH_UNAVAILABLE_MESSAGE);
}

// ─── Client-side results state (shared by the provider, viewers, results UI) ──

/** A single match held in client state after a face search. */
export interface ClientSearchMatch {
  photoId: string;
  similarity: number;
  bucket: SearchMatchBucket;
}

/** Localized copy for the face-search results view. */
export interface FaceSearchResultsLabels {
  veryLikelyTitle: string;
  veryLikelySubtitle: string;
  likelyTitle: string;
  likelySubtitle: string;
  possiblyTitle: string;
  possiblySubtitle: string;
  viewAllPhotos: string;
  noMatchesTitle: string;
  noMatchesBody: string;
  tryAgain: string;
  partialIndexingNotice: string;
  /** "We found 1 photo of you" / "We found {n} photos of you". */
  foundCountOne: string;
  foundCountMany: string;
}

/** A photo item with an id — the minimum `buildBuckets` needs. */
interface BucketablePhoto {
  id: string;
}

export interface BucketedMatches<T extends BucketablePhoto> {
  veryLikely: T[];
  likely: T[];
  possibly: T[];
}

/**
 * Split face-search matches into confidence buckets, mapped onto the gallery's
 * photo items — most-confident first within each bucket. Pure; wrap the call
 * site in `useMemo`.
 */
export function buildBuckets<T extends BucketablePhoto>(
  matches: ClientSearchMatch[] | null,
  items: T[],
): BucketedMatches<T> {
  if (!matches || matches.length === 0) {
    return { veryLikely: [], likely: [], possibly: [] };
  }
  const lookup = new Map(items.map((p) => [p.id, p]));
  const result: BucketedMatches<T> = { veryLikely: [], likely: [], possibly: [] };
  const sorted = [...matches].sort((a, b) => b.similarity - a.similarity);
  for (const match of sorted) {
    const item = lookup.get(match.photoId);
    if (!item) continue; // orphan — defended client-side
    if (match.bucket === 'very-likely') result.veryLikely.push(item);
    else if (match.bucket === 'likely') result.likely.push(item);
    else result.possibly.push(item);
  }
  return result;
}
