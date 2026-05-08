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

export function getTodayISOString(): string {
  return new Date().toISOString().split('T')[0];
}

export function getYesterdayISOString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
