import { describe, expect, it } from 'vitest';
import { formatEventDate, formatSessionTime, normalizeSessionTime } from '@/lib/format-date';

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

describe('normalizeSessionTime (T-106)', () => {
  it('passes a valid "HH:mm" through unchanged', () => {
    expect(normalizeSessionTime('09:30')).toBe('09:30');
    expect(normalizeSessionTime('  23:59  ')).toBe('23:59');
  });

  it('accepts a seconds-bearing "HH:mm:ss" and drops the seconds (no silent wipe)', () => {
    expect(normalizeSessionTime('09:30:00')).toBe('09:30');
    expect(normalizeSessionTime('23:59:45')).toBe('23:59');
  });

  it('returns null for empty / nullish input', () => {
    expect(normalizeSessionTime('')).toBeNull();
    expect(normalizeSessionTime('   ')).toBeNull();
    expect(normalizeSessionTime(null)).toBeNull();
    expect(normalizeSessionTime(undefined)).toBeNull();
  });

  it('returns null for malformed or out-of-range times', () => {
    expect(normalizeSessionTime('9:30')).toBeNull(); // needs two-digit hour
    expect(normalizeSessionTime('24:00')).toBeNull(); // hour out of range
    expect(normalizeSessionTime('12:60')).toBeNull(); // minute out of range
    expect(normalizeSessionTime('nope')).toBeNull();
  });
});

describe('formatSessionTime (T-106)', () => {
  it('formats a naive time in the locale clock convention', () => {
    // en → 12-hour with AM/PM; es → 24-hour. Assert the shape, not exact glyphs.
    expect(formatSessionTime('09:30', 'en')).toMatch(/9:30\s?AM/i);
    expect(formatSessionTime('09:30', 'es')).toContain('9:30');
    expect(formatSessionTime('09:30', 'en')).not.toBe(formatSessionTime('09:30', 'es'));
  });

  it('accepts the DB "HH:MM:SS" form', () => {
    expect(formatSessionTime('09:30:00', 'en')).toMatch(/9:30\s?AM/i);
  });

  it('returns undefined for empty / invalid input', () => {
    expect(formatSessionTime(null, 'en')).toBeUndefined();
    expect(formatSessionTime('', 'en')).toBeUndefined();
    expect(formatSessionTime('25:00', 'en')).toBeUndefined();
    expect(formatSessionTime('nope', 'en')).toBeUndefined();
  });
});
