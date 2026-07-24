import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/env.mjs';

/**
 * Reveal-gate proof cookie (T-177).
 *
 * When an event has `reveal_gate_enabled`, its photos are withheld from every
 * listing path until a visitor proves a face-search match. This module mints
 * and verifies the signed cookie that records which photo ids a visitor has
 * proven, so a page reload re-serves them without a second (billable) face
 * search. It is a signed value, not a secret store: it only re-authorizes
 * photos the visitor already matched.
 *
 * Fail-closed: any tampering, wrong event, or expiry yields the empty set.
 */

/** Cookie lifetime — matches the value baked into the token's `exp`. */
export const REVEAL_COOKIE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Upper bound on ids carried in the cookie. A person can appear in more photos
 * than this at a large event; the in-session search response still returns the
 * full matched set, but the cookie (and thus a reload) is capped to stay under
 * the ~4 KB cookie limit. Documented v1 edge — exposure is limited regardless.
 */
export const REVEAL_MAX_PHOTO_IDS = 100;

const COOKIE_PREFIX = 'pm_reveal_';

/**
 * Whether an event row has the reveal gate on (T-177). Accepts any event-shaped
 * value so it reads the flag even where the generated row type predates the
 * column (the `select('*')` row carries it at runtime).
 */
export function isEventRevealGated(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  return Boolean((event as { reveal_gate_enabled?: unknown }).reveal_gate_enabled);
}

/** Per-event cookie name, so grants for different events don't collide. */
export function revealCookieName(eventId: string): string {
  return `${COOKIE_PREFIX}${eventId}`;
}

function signingSecret(): string {
  // Prefer a dedicated secret; fall back to the service-role key so the feature
  // works (and the app boots) without a new env var configured.
  return env.REVEAL_TOKEN_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY;
}

function sign(encodedBody: string): string {
  return createHmac('sha256', signingSecret()).update(encodedBody).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Build the signed cookie value proving a match over `photoIds` for `eventId`.
 * Ids are de-duped, sorted, and capped; `expiresAtSeconds` is embedded so the
 * verifier needs no external state.
 */
export function buildRevealCookieValue(
  eventId: string,
  photoIds: string[],
  nowSeconds: number,
): string {
  const capped = Array.from(new Set(photoIds)).sort().slice(0, REVEAL_MAX_PHOTO_IDS);
  const exp = nowSeconds + REVEAL_COOKIE_TTL_SECONDS;
  // eventId (UUID) and ids (UUIDs joined by ',') contain no '.', so the three
  // fields round-trip cleanly through a '.'-split after base64 decode.
  const body = `${eventId}.${capped.join(',')}.${exp}`;
  const encoded = Buffer.from(body).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

/**
 * Verify a cookie value and return the proven photo-id set for `eventId`.
 * Returns an empty set on a missing/malformed/tampered/expired/wrong-event
 * cookie (fail-closed) — callers must treat an empty set as "reveal nothing".
 */
export function readRevealedPhotoIds(
  cookieValue: string | undefined | null,
  eventId: string,
  nowSeconds: number,
): Set<string> {
  const empty = new Set<string>();
  if (!cookieValue) return empty;

  const sep = cookieValue.lastIndexOf('.');
  if (sep <= 0) return empty;

  const encoded = cookieValue.slice(0, sep);
  const sig = cookieValue.slice(sep + 1);
  if (!safeEqual(sig, sign(encoded))) return empty;

  let body: string;
  try {
    body = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return empty;
  }

  const parts = body.split('.');
  if (parts.length !== 3) return empty;
  const [tokenEventId, idsPart, expPart] = parts;
  if (tokenEventId !== eventId) return empty;

  const exp = Number(expPart);
  if (!Number.isFinite(exp) || exp < nowSeconds) return empty;

  if (idsPart === '') return empty;
  return new Set(idsPart.split(','));
}
