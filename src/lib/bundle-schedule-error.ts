/**
 * Client-safe error channel for bundle-ladder rejections (T-203).
 *
 * Server actions never localize — no server action in this app imports
 * `getDictionary` — so the *reason* a ladder was rejected has to travel across
 * the RSC boundary as a parseable string that the form turns into localized
 * copy. Same prefix scheme as `min-photo-price.ts` and `plan-limits.ts`:
 * React's server-action serialization preserves `.message` but not a custom
 * `.name` or extra fields.
 *
 * ⚠️ Next redacts thrown Server Action messages in production (the T-189
 * finding), so the localized copy only renders reliably in dev — the same
 * caveat that already applies to `PlanLimitError` and `MIN_PHOTO_PRICE:`. Zod
 * issues raised inside `superRefine` come back through the action's own
 * validation result rather than a thrown error, which is why the create/edit
 * forms can still show these.
 */

import type { BundleScheduleError } from '@/lib/bundle-pricing';
import { formatMinPhotoPrice } from '@/lib/min-photo-price';

/** Stable prefix; the remainder is the error code, optionally `:<cents>`. */
export const BUNDLE_SCHEDULE_ERROR_PREFIX = 'BUNDLE_TIERS:';

/** Build the sentinel message the event write paths report. */
export function bundleScheduleErrorMessage(error: BundleScheduleError, minCents?: number): string {
  return minCents === undefined
    ? `${BUNDLE_SCHEDULE_ERROR_PREFIX}${error}`
    : `${BUNDLE_SCHEDULE_ERROR_PREFIX}${error}:${minCents}`;
}

export interface ParsedBundleScheduleError {
  error: BundleScheduleError;
  minCents: number | null;
}

/**
 * Every code `validateBundleSchedule` / the submission parsers can produce.
 *
 * An omission here is invisible in review and total at runtime: `parseBundle
 * ScheduleError` returns null for an unlisted code, so the caller falls through
 * to `error.message` and the photographer gets the raw `BUNDLE_TIERS:<code>`
 * sentinel (dev) or Next's redacted generic error (prod), while the localized
 * copy that DOES exist in both dictionaries is simply unreachable. That is what
 * had happened to the three `all_photos_*` codes.
 *
 * ⚠️ Adding a `BundleScheduleError` member? Add it here and to
 * `bundlePricing.errors` in `en.json` + `es.json`; the exhaustiveness test in
 * `test/unit/src/lib/bundle-schedule-error.test.ts` fails otherwise.
 */
const KNOWN_ERRORS: ReadonlySet<string> = new Set<BundleScheduleError>([
  'empty',
  'too_many_tiers',
  'quantity_not_integer',
  'quantity_too_low',
  'quantity_not_increasing',
  'total_not_integer',
  'total_below_floor',
  'total_not_increasing',
  'total_not_a_discount',
  'not_parseable',
  'all_photos_below_floor',
  'all_photos_not_above_unit',
  'all_photos_below_a_pack',
]);

/**
 * Parse a ladder rejection out of a possibly-serialized error or message.
 * Returns null when it isn't one — including for an unrecognized code, so a
 * mangled payload falls through to the caller's generic handler instead of
 * rendering an empty or raw string at the user.
 */
export function parseBundleScheduleError(err: unknown): ParsedBundleScheduleError | null {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : (null as string | null);
  if (message === null) return null;
  if (!message.startsWith(BUNDLE_SCHEDULE_ERROR_PREFIX)) return null;

  const raw = message.slice(BUNDLE_SCHEDULE_ERROR_PREFIX.length);
  const [code, centsRaw] = raw.split(':');
  if (!KNOWN_ERRORS.has(code)) return null;

  let minCents: number | null = null;
  if (centsRaw !== undefined) {
    const parsed = Number.parseInt(centsRaw, 10);
    // A malformed amount must not render as "at least €NaN" — drop it and let
    // the copy fall back to its amount-less form.
    if (Number.isFinite(parsed) && parsed >= 0 && String(parsed) === centsRaw.trim()) {
      minCents = parsed;
    }
  }

  return { error: code as BundleScheduleError, minCents };
}

/**
 * Turn a caught error into localized copy, or null when it isn't a ladder
 * rejection — so call sites read as a single branch.
 *
 * `templates` is the `bundlePricing.errors` dictionary block. The
 * `total_below_floor` template may contain `{min}`, substituted with the
 * formatted floor when one travelled with the error.
 */
export function bundleScheduleErrorText(
  err: unknown,
  templates: Partial<Record<BundleScheduleError, string>> & { fallback: string },
): string | null {
  const parsed = parseBundleScheduleError(err);
  if (parsed === null) return null;

  const template = templates[parsed.error] ?? templates.fallback;
  if (parsed.minCents === null) return template.replace('{min}', '');
  return template.replace('{min}', formatMinPhotoPrice(parsed.minCents));
}
