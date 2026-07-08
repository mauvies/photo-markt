import type { RoleSlug } from '@/lib/roles';

/**
 * Pure composition helpers for the photographer dashboard navigation (T-075).
 *
 * The nav is rendered across three surfaces that must stay in sync — the
 * desktop sidebar, the desktop avatar dropdown, and the mobile bottom-nav
 * avatar dropdown. Keeping the "which items appear where" decisions here (as
 * pure functions) makes that composition testable and prevents the three
 * surfaces from drifting apart.
 */

export type PhotographerSidebarKey =
  | 'overview'
  | 'events'
  | 'createEvent'
  | 'sales'
  | 'profile'
  | 'settings';

export interface PhotographerSidebarLabels {
  overview: string;
  events: string;
  createEvent: string;
  /** Formerly "Earnings"/"Ganancias" — renamed to Sales/Ventas (T-075). */
  sales: string;
  profile: string;
  settings: string;
}

export interface PhotographerSidebarItem {
  key: PhotographerSidebarKey;
  title: string;
  /** Locale-agnostic path; callers localize it. */
  url: string;
}

/**
 * The six photographer sidebar links, in display order:
 * Overview · Events · Create event · Sales · Profile · Settings.
 *
 * "Profile" is the dashboard-wrapped public-profile preview (not the Settings
 * profile tab); "Settings" opens the tabbed settings page. Both are distinct
 * and intentional.
 */
export function buildPhotographerSidebarItems(
  labels: PhotographerSidebarLabels,
): PhotographerSidebarItem[] {
  return [
    { key: 'overview', title: labels.overview, url: '/dashboard/photographer' },
    { key: 'events', title: labels.events, url: '/dashboard/photographer/events' },
    { key: 'createEvent', title: labels.createEvent, url: '/dashboard/photographer/events/new' },
    { key: 'sales', title: labels.sales, url: '/dashboard/photographer/sales' },
    { key: 'profile', title: labels.profile, url: '/dashboard/photographer/profile/preview' },
    { key: 'settings', title: labels.settings, url: '/dashboard/photographer/settings' },
  ];
}

/**
 * Support & Feedback moved out of the photographer sidebar and into the avatar
 * dropdown (T-075). The sidebar's secondary section is therefore hidden for
 * photographers; any other role that renders the shared sidebar keeps it.
 */
export function showSidebarSupportFeedback(role: RoleSlug): boolean {
  return role !== 'photographer';
}

export type AccountMenuSurface = 'desktop-header' | 'mobile-bottom';
export type AccountLinkKey = 'profile' | 'settings';

/**
 * Which account links (Profile / Settings) the avatar dropdown surfaces, by
 * role and viewport surface.
 *
 * - Photographer + desktop header: none — the sidebar beside it already links
 *   both Profile and Settings, so repeating them in the dropdown is redundant.
 * - Photographer + mobile bottom nav: both — the bottom nav only holds the
 *   primary work links (Overview/Events/Create/Sales), so Profile and Settings
 *   are only reachable here.
 * - Talent (either surface): both — talent has no sidebar and its top nav
 *   omits Settings, so the dropdown is their access point.
 *
 * Payouts and Billing are never surfaced in the dropdown anymore; they live
 * inside the Settings page (reachable via the Settings link above).
 */
export function accountDropdownLinks(
  role: RoleSlug,
  surface: AccountMenuSurface,
): AccountLinkKey[] {
  if (role === 'photographer' && surface === 'desktop-header') return [];
  return ['profile', 'settings'];
}
