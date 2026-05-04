import { format, parseISO } from 'date-fns';
import type { DateRange } from 'react-day-picker';

export const DEFAULT_RADIUS_KM = 25;
export const BLUR_DISMISS_DELAY_MS = 150;

export function todayRange(): DateRange {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return { from: d, to: d };
}

export function last3DaysRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 2);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export function lastWeekRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export function parseDateStr(s: string): Date | undefined {
  if (!s) return undefined;
  try {
    return parseISO(s);
  } catch {
    return undefined;
  }
}

// Detect access-code-like inputs: short, no spaces, uppercase alphanumeric (with -/_).
// Lowercase or natural-language inputs fall through to regular search.
export function isLikelyAccessCode(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 4 || trimmed.length > 16) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[A-Z0-9_-]+$/.test(trimmed);
}

export function whenLabel(from: Date | undefined, to: Date | undefined): string | null {
  if (from && to) {
    const sameDay = format(from, 'yyyy-MM-dd') === format(to, 'yyyy-MM-dd');
    return sameDay ? format(from, 'MMM d') : `${format(from, 'MMM d')} – ${format(to, 'MMM d')}`;
  }
  if (from) return format(from, 'MMM d');
  if (to) return `Until ${format(to, 'MMM d')}`;
  return null;
}
