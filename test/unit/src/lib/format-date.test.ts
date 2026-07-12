import { describe, expect, it } from 'vitest';
import { formatEventDate } from '@/lib/format-date';

// Noon UTC keeps the calendar day stable across the runner's timezone (the
// suite doesn't pin TZ), so these assertions test the locale field ORDER, not
// an off-by-one day.
const JUNE_6 = '2026-06-06T12:00:00.000Z';

describe('formatEventDate (T-103)', () => {
  it('uses English month-day-year order for `en`', () => {
    expect(formatEventDate(JUNE_6, 'en')).toBe('June 6, 2026');
  });

  it('uses Spanish day-month-year order for `es` (natural, not the English abbreviation)', () => {
    const es = formatEventDate(JUNE_6, 'es');
    expect(es).toBe('6 de junio de 2026');
    // Regression against the old `toDateString()` output, which was always the
    // English abbreviation ("Jun 06 2026") regardless of locale.
    expect(es).not.toContain('Jun ');
  });

  it('produces different orderings per locale from the same instant', () => {
    expect(formatEventDate(JUNE_6, 'en')).not.toBe(formatEventDate(JUNE_6, 'es'));
  });

  it('returns undefined for empty or unparseable input', () => {
    expect(formatEventDate(undefined, 'en')).toBeUndefined();
    expect(formatEventDate('', 'en')).toBeUndefined();
    expect(formatEventDate('not-a-date', 'en')).toBeUndefined();
  });
});
