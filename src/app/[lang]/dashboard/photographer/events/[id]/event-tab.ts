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

/** The scoped-edit sections `/edit?section=` accepts (T-179, T-203). */
export type ScopedEditSection = 'info' | 'settings' | 'pricing';

/**
 * Which tab a scoped `/edit?section=…` save should land on (T-213).
 *
 * The redirect was hardcoded to `details` when `info` and `settings` were the
 * only sections — both of which the Details tab renders, so the photographer
 * saw their change land. `pricing` broke that: Details shows no price at all,
 * so saving a ladder from `?section=pricing` gave no visible confirmation that
 * anything had changed. The rule is "return to the tab that displays what was
 * just edited", which is a mapping, not a constant.
 */
export function eventTabForScopedSection(section: ScopedEditSection): EventTab {
  return section === 'pricing' ? 'pricing' : 'details';
}
