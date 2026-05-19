/**
 * Types + helpers shared between the `searchFacesInEvent` Server Action and
 * the client modal/wrapper that consume it. Lives in a non-`'use server'`
 * file because Next.js requires `'use server'` modules to export ONLY async
 * functions — sync helpers and runtime values (even type-only exports are
 * fine, but mixing them with `'use server'` is fragile across bundlers).
 */

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
 * Parseable message prefix on the rate-limit error. Mirrors the
 * `PLAN_LIMIT:` pattern from `lib/plan-limits.ts` so the client can detect
 * the type from the message string alone (React strips custom Error
 * subclasses in production).
 */
export const FACE_SEARCH_RATE_LIMIT_PREFIX = 'RATE_LIMIT:face-search';

export function isFaceSearchRateLimitError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(FACE_SEARCH_RATE_LIMIT_PREFIX);
}
