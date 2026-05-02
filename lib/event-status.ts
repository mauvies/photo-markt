export type EventStatus = 'upcoming' | 'completed';

export function getEventStatus(date: string): EventStatus {
  const [year, month, day] = date.split('-').map(Number);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const eventDate = new Date(year, month - 1, day);
  return eventDate >= todayMidnight ? 'upcoming' : 'completed';
}

export function getTodayISOString(): string {
  return new Date().toISOString().split('T')[0];
}

export function getYesterdayISOString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
