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
