export type EventStatus = 'upcoming' | 'completed';

export function getEventStatus(date: string): EventStatus {
  const [year, month, day] = date.split('-').map(Number);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const eventDate = new Date(year, month - 1, day);
  // Strictly future = upcoming. Today and past = completed (the gallery
  // shows; if there are no photos yet, the empty state covers it).
  return eventDate > todayMidnight ? 'upcoming' : 'completed';
}

/**
 * Whether collaborative contributors can upload photos right now.
 * Opens the day of the event (so attendees can upload during/after) and stays
 * open afterwards. Distinct from `getEventStatus`: that helper still returns
 * `'upcoming'` for today's date, which is correct for the gallery's "coming
 * soon" state but too restrictive for live uploads.
 */
export function isCollaborativeUploadOpen(date: string): boolean {
  const [year, month, day] = date.split('-').map(Number);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const eventDate = new Date(year, month - 1, day);
  return todayMidnight >= eventDate;
}

/**
 * Whether an event routes uploads through a moderation queue (the dedicated
 * "Pending" tab) rather than showing owner uploads inline while they validate.
 * True for collaborative or organizer events that require upload approval —
 * the same predicate the photographer event page and its load-more action use
 * to decide whether the main grid includes pending photos.
 */
export function eventUsesModerationQueue(event: {
  is_collaborative: boolean;
  type: 'solo' | 'collaborative' | 'organizer';
  require_upload_approval: boolean;
}): boolean {
  return (event.is_collaborative || event.type === 'organizer') && event.require_upload_approval;
}

/**
 * Window (in days) used by `isEventSoon`. Tuned for the photographer dashboard
 * "Upcoming" badge — events sooner than this are surfaced; farther-out events
 * stay unbadged to avoid drowning the grid in pills.
 */
export const UPCOMING_SOON_DAYS = 14;

/**
 * True when the event date is in the future and within `withinDays` days from
 * today (default 14). Events on past dates and events farther out return false.
 */
export function isEventSoon(date: string, withinDays: number = UPCOMING_SOON_DAYS): boolean {
  const [year, month, day] = date.split('-').map(Number);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const eventDate = new Date(year, month - 1, day);
  const diffMs = eventDate.getTime() - todayMidnight.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > 0 && diffDays <= withinDays;
}

export function getTodayISOString(): string {
  return new Date().toISOString().split('T')[0];
}

export function getYesterdayISOString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
