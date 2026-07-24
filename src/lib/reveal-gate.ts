import { cookies } from 'next/headers';
import { env } from '@/env.mjs';
import {
  buildRevealCookieValue,
  REVEAL_COOKIE_TTL_SECONDS,
  REVEAL_MAX_PHOTO_IDS,
  readRevealedPhotoIds,
  revealCookieName,
} from './reveal-token';

/**
 * Request-scoped helpers around the reveal-gate proof cookie (T-177). The pure
 * sign/verify logic lives in `reveal-token.ts`; here we read/write the cookie
 * from a Server Component / Server Action request context.
 */

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * The photo ids this visitor has proven a match for on `eventId`. Empty set
 * when there is no valid proof (fail-closed) — callers treat that as "reveal
 * nothing". Only meaningful for gated events; safe to call regardless.
 */
export async function getProvenRevealIds(eventId: string): Promise<Set<string>> {
  const store = await cookies();
  const value = store.get(revealCookieName(eventId))?.value;
  return readRevealedPhotoIds(value, eventId, nowSeconds());
}

/**
 * Record a proven match: union `photoIds` into any existing proof for the event
 * and (re)issue the cookie with a fresh expiry. Called by the search action
 * after a successful face match on a gated event.
 */
export async function grantReveal(eventId: string, photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  const store = await cookies();
  const now = nowSeconds();
  const existing = readRevealedPhotoIds(store.get(revealCookieName(eventId))?.value, eventId, now);
  // Put THIS search's ids first, so if the union exceeds the cookie cap it's an
  // earlier-proven id that's dropped — never a photo the visitor is currently
  // looking at. `buildRevealCookieValue` sorts for a stable signature; slicing
  // here keeps the newest set within the cap before that.
  const merged = Array.from(new Set([...photoIds, ...existing])).slice(0, REVEAL_MAX_PHOTO_IDS);
  store.set(revealCookieName(eventId), buildRevealCookieValue(eventId, merged, now), {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REVEAL_COOKIE_TTL_SECONDS,
  });
}
