export type EventTab = 'photos' | 'details' | 'pricing' | 'share';

/**
 * Resolve the `?tab=` search param into a valid top-level tab, defaulting to
 * `photos` (the tab the photographer lands on when opening an event). Mirrors
 * the Sales page's `parseTab` helper — same URL-driven pattern.
 *
 * Lives in a plain (non-`'use client'`) module so the server page can call it
 * directly — a function exported from a client module is a client reference and
 * cannot be invoked from a Server Component.
 */
export function parseEventTab(value: string | string[] | undefined): EventTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'details' || raw === 'pricing' || raw === 'share' ? raw : 'photos';
}
