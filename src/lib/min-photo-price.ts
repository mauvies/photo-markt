/**
 * Client-safe error channel for the minimum-photo-price floor (billing v2,
 * T-194/T-195).
 *
 * The floor itself is server-side config (`getMinPhotoPriceCents` in
 * `lib/plans.ts`, read from `MIN_PHOTO_PRICE_CENTS`). This module carries only
 * the part the browser needs: a stable, parseable message so the create/edit
 * forms can turn a rejected price into localized copy that states the actual
 * floor — server actions never localize (no server action in the app imports
 * `getDictionary`), so the amount has to travel in the message.
 *
 * Same prefix scheme as `plan-limits.ts`: React's server-action serialization
 * preserves `.message` but not a custom `.name` or extra fields.
 */

import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';

/** Stable prefix; the remainder of the message is the floor in cents. */
export const MIN_PHOTO_PRICE_ERROR_PREFIX = 'MIN_PHOTO_PRICE:';

/** Build the sentinel message thrown/reported by the event write paths. */
export function minPhotoPriceErrorMessage(minCents: number): string {
  return `${MIN_PHOTO_PRICE_ERROR_PREFIX}${minCents}`;
}

/**
 * Parse the floor (in cents) out of a possibly-serialized min-price error.
 * Returns null when the value isn't one — including when the payload isn't a
 * finite non-negative integer, so a mangled message can't render as "at least
 * €NaN".
 */
export function getMinPhotoPriceCentsFromError(err: unknown): number | null {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : (null as string | null);
  if (message === null) return null;
  if (!message.startsWith(MIN_PHOTO_PRICE_ERROR_PREFIX)) return null;

  const raw = message.slice(MIN_PHOTO_PRICE_ERROR_PREFIX.length);
  const cents = Number.parseInt(raw, 10);
  if (!Number.isFinite(cents) || cents < 0 || String(cents) !== raw.trim()) return null;
  return cents;
}

/** True when the error is the min-photo-price rejection. */
export function isMinPhotoPriceError(err: unknown): boolean {
  return getMinPhotoPriceCentsFromError(err) !== null;
}

/** Render the floor for display, e.g. 150 → "€1.50". */
export function formatMinPhotoPrice(cents: number): string {
  return `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;
}

/**
 * Turn a caught error into the localized "price too low" message, or null when
 * it isn't one — so call sites read as a single branch and can fall through to
 * their generic handler.
 */
export function minPhotoPriceMessage(err: unknown, template: string): string | null {
  const cents = getMinPhotoPriceCentsFromError(err);
  if (cents === null) return null;
  return template.replace('{min}', formatMinPhotoPrice(cents));
}
