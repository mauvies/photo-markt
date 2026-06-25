/**
 * Shared (non-"use server") constants + types for talent bib search. The
 * Server Action lives in `actions.ts`, which may only export async functions —
 * so its rate-limit prefix and result type live here, mirroring
 * `face-search-shared.ts`. (T-032)
 */

export const BIB_SEARCH_RATE_LIMIT_PREFIX = 'bib-search-rate-limit';

export interface SearchPhotosByBibResult {
  /** Photo ids (public/visible only) whose detected bib matches. */
  photoIds: string[];
}

/** True when the thrown error is the bib-search rate-limit signal. */
export function isBibSearchRateLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(BIB_SEARCH_RATE_LIMIT_PREFIX);
}
