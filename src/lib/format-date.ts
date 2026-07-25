/**
 * Locale-aware long date formatting.
 *
 * `Intl.DateTimeFormat` picks each locale's natural field order automatically:
 * "June 6, 2026" for `en`, "6 de junio de 2026" for `es`. Returns `undefined`
 * for empty or unparseable input so callers can omit the segment cleanly.
 *
 * Shared by the event metadata line (T-103) and the photo detail modal (T-066)
 * so the two surfaces never drift into different date formats.
 */
export function formatEventDate(iso: string | undefined, locale: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * Normalizes a form-supplied session time to a canonical "HH:mm" string, or
 * `null` when empty / not a valid time-of-day. Shared by the create and edit
 * event actions so both gate the value identically before it hits the DB (T-106).
 */
export function normalizeSessionTime(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  // Accept "HH:mm" and "HH:mm:ss" (some inputs/locales append seconds) — always
  // normalize to "HH:mm" so a seconds-bearing value never fails to parse and
  // silently wipes a stored time.
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${match[1]}:${match[2]}`;
}

/**
 * Formats a naive local time-of-day (the event's manual session time, stored as
 * "HH:MM" or "HH:MM:SS") into the locale's short clock format — "9:30 AM" (en),
 * "9:30" (es). Returns `undefined` for empty/unparseable input so the segment
 * can be omitted (T-106). No timezone is applied: the stored value is already
 * "the local time the photographer typed".
 */
export function formatSessionTime(
  value: string | null | undefined,
  locale: string,
): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  // Anchor to an arbitrary date — only the time fields are formatted.
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/**
 * Session-range cross-field rule (T-180), shared by the create/edit server
 * actions and the client schemas: an end time requires a start, and the end must
 * be after the start. Both empty (unset) pass — the pair stays optional. Inputs
 * are the raw form strings; a normalized "HH:mm[:ss]" or a `time`-input "HH:mm"
 * compares chronologically as a string because the hour is zero-padded.
 */
export function isValidSessionRange(
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  const s = (start ?? '').trim();
  const e = (end ?? '').trim();
  if (!e) return true; // no end → always fine
  if (!s) return false; // end without start is not allowed
  return e > s; // end must be strictly after start
}

/** User-facing message when {@link isValidSessionRange} fails (T-180). */
export const SESSION_RANGE_ERROR = 'Session end time must be after the start time.';

/**
 * Formats the manual session time as a RANGE when both a start and an end are
 * present ("9:30 AM – 12:00 PM"), or just the start when there's no end (T-180).
 * Returns `undefined` when there's no valid start — mirroring `formatSessionTime`
 * so the whole segment can be omitted. An end without a start never renders a
 * lone end (the create/edit forms enforce "end requires start"), so a stray
 * end-only value is dropped here as a display-layer safety net.
 */
export function formatSessionTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
  locale: string,
): string | undefined {
  const formattedStart = formatSessionTime(start, locale);
  if (!formattedStart) return undefined;
  const formattedEnd = formatSessionTime(end, locale);
  return formattedEnd ? `${formattedStart} – ${formattedEnd}` : formattedStart;
}
