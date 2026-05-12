import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getEventStatus,
  getTodayISOString,
  getYesterdayISOString,
  isCollaborativeUploadOpen,
  isEventSoon,
  UPCOMING_SOON_DAYS,
} from '@/lib/event-status';

// Pin "today" to a known date so the date-sensitive tests stay deterministic
// regardless of when CI runs them.
const PINNED_TODAY = new Date('2026-05-15T10:00:00Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(PINNED_TODAY);
});

afterAll(() => {
  vi.useRealTimers();
});

describe('getEventStatus', () => {
  it('returns "upcoming" for strictly future dates', () => {
    expect(getEventStatus('2026-05-20')).toBe('upcoming');
    expect(getEventStatus('2027-01-01')).toBe('upcoming');
  });

  it('returns "completed" for past dates', () => {
    expect(getEventStatus('2026-05-14')).toBe('completed');
    expect(getEventStatus('2025-01-01')).toBe('completed');
  });

  it('returns "completed" on the day of the event (today)', () => {
    // The helper deliberately flips to "completed" the day-of so the gallery
    // shows up for attendees uploading from the venue.
    expect(getEventStatus('2026-05-15')).toBe('completed');
  });
});

describe('isCollaborativeUploadOpen', () => {
  it('is closed before the event day', () => {
    expect(isCollaborativeUploadOpen('2026-05-16')).toBe(false);
  });

  it('opens on the event day', () => {
    expect(isCollaborativeUploadOpen('2026-05-15')).toBe(true);
  });

  it('stays open after the event day', () => {
    expect(isCollaborativeUploadOpen('2026-05-14')).toBe(true);
    expect(isCollaborativeUploadOpen('2024-01-01')).toBe(true);
  });
});

describe('isEventSoon', () => {
  it('is true for events within the default 14-day window', () => {
    expect(isEventSoon('2026-05-16')).toBe(true); // +1 day
    expect(isEventSoon('2026-05-29')).toBe(true); // +14 days (boundary)
  });

  it('is false outside the window', () => {
    expect(isEventSoon('2026-05-30')).toBe(false); // +15 days
    expect(isEventSoon('2026-06-30')).toBe(false);
  });

  it('is false for today and past events', () => {
    expect(isEventSoon('2026-05-15')).toBe(false);
    expect(isEventSoon('2026-05-14')).toBe(false);
  });

  it('respects a custom window', () => {
    expect(isEventSoon('2026-05-21', 7)).toBe(true);
    expect(isEventSoon('2026-05-23', 7)).toBe(false);
  });

  it('exports the default window constant for reuse', () => {
    expect(UPCOMING_SOON_DAYS).toBe(14);
  });
});

describe('getTodayISOString / getYesterdayISOString', () => {
  it('today returns the date portion of the pinned timestamp', () => {
    expect(getTodayISOString()).toBe('2026-05-15');
  });

  it('yesterday is exactly one day before today', () => {
    expect(getYesterdayISOString()).toBe('2026-05-14');
  });
});
