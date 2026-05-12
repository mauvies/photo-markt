import { describe, expect, it } from 'vitest';
import { nextQuerySuffix, rewritePostLoginNext, safeNext } from '@/lib/auth/safe-next';

describe('safeNext', () => {
  it('accepts a plain internal path', () => {
    expect(safeNext('/dashboard/talent')).toBe('/dashboard/talent');
  });

  it('accepts paths with query and hash', () => {
    expect(safeNext('/events?tab=upcoming#top')).toBe('/events?tab=upcoming#top');
  });

  it('rejects null / undefined / empty', () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext('')).toBeNull();
  });

  it('rejects non-string input (defensive)', () => {
    // Real-world: comes off a query param; runtime types are messier than TS suggests.
    expect(safeNext(123 as unknown as string)).toBeNull();
  });

  it('rejects external URLs', () => {
    expect(safeNext('https://evil.com/path')).toBeNull();
    expect(safeNext('http://evil.com')).toBeNull();
  });

  it('rejects protocol-relative URLs (// and /\\)', () => {
    // Both forms expand to a different origin in browsers.
    expect(safeNext('//evil.com/path')).toBeNull();
    expect(safeNext('/\\evil.com/path')).toBeNull();
  });

  it('rejects paths that do not start with /', () => {
    expect(safeNext('dashboard')).toBeNull();
    expect(safeNext('events?tab=1')).toBeNull();
  });

  it('rejects paths containing control characters or whitespace', () => {
    expect(safeNext('/path with space')).toBeNull();
    expect(safeNext('/path\twith\ttab')).toBeNull();
    expect(safeNext('/path\nwith\nnewline')).toBeNull();
    expect(safeNext('/path\x00null')).toBeNull();
  });
});

describe('nextQuerySuffix', () => {
  it('builds ?next=<encoded> when value is safe', () => {
    expect(nextQuerySuffix('/dashboard/talent?tab=orders')).toBe(
      '?next=%2Fdashboard%2Ftalent%3Ftab%3Dorders',
    );
  });

  it('uses & as the leading separator when requested', () => {
    expect(nextQuerySuffix('/x', '&')).toBe('&next=%2Fx');
  });

  it('returns empty string for unsafe / missing values', () => {
    expect(nextQuerySuffix(null)).toBe('');
    expect(nextQuerySuffix('//evil')).toBe('');
    expect(nextQuerySuffix('javascript:alert(1)')).toBe('');
  });
});

describe('rewritePostLoginNext', () => {
  it('rewrites /events root to the dashboard equivalent', () => {
    expect(rewritePostLoginNext('/events')).toBe('/dashboard/talent/events');
  });

  it('rewrites /events/<param>', () => {
    expect(rewritePostLoginNext('/events/abc-2026')).toBe('/dashboard/talent/events/abc-2026');
  });

  it('rewrites /events/<param>/anything (sub-routes)', () => {
    expect(rewritePostLoginNext('/events/abc/photos')).toBe('/dashboard/talent/events/abc/photos');
  });

  it('preserves the query string on /events?...', () => {
    expect(rewritePostLoginNext('/events?status=upcoming')).toBe(
      '/dashboard/talent/events?status=upcoming',
    );
  });

  it('preserves the hash on /events#...', () => {
    expect(rewritePostLoginNext('/events#top')).toBe('/dashboard/talent/events#top');
  });

  it('leaves unrelated paths alone', () => {
    expect(rewritePostLoginNext('/dashboard/talent/photos')).toBe('/dashboard/talent/photos');
    expect(rewritePostLoginNext('/photographer/some-user')).toBe('/photographer/some-user');
  });
});
