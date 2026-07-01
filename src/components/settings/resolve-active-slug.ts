import type { SettingsSection, SettingsSectionSlug } from './settings-shell';

/**
 * Sibling subroutes that live *next to* a section's page (not nested under its
 * href) but conceptually belong to that section's tab. Keyed by the route's
 * own path segment. Example: `/settings/payout-profile` is a sibling of
 * `/settings/payouts`, yet both belong under the "Payouts" tab.
 */
const SUBROUTE_TO_PARENT_SLUG: Record<string, SettingsSectionSlug> = {
  'payout-profile': 'payouts',
};

/**
 * Resolve which settings tab should be highlighted for a given pathname.
 *
 * Precedence:
 *  1. Exact match on a section's href.
 *  2. Nested subroute (`{href}/…`) highlights that section's tab.
 *  3. Known sibling subroutes map to their parent section (e.g.
 *     `payout-profile` → `payouts`) — only when that section is present.
 *  4. Fallback to the first section.
 *
 * Pure and route-shape agnostic (works with the locale-prefixed pathnames
 * `usePathname()` returns) so it can be unit-tested without the client shell.
 */
export function resolveActiveSlug(
  pathname: string,
  sections: SettingsSection[],
): SettingsSectionSlug | undefined {
  const exact = sections.find((s) => pathname === s.href);
  if (exact) return exact.slug;

  const nested = sections.find((s) => pathname.startsWith(`${s.href}/`));
  if (nested) return nested.slug;

  const segments = pathname.split('/').filter(Boolean);
  for (const [segment, parentSlug] of Object.entries(SUBROUTE_TO_PARENT_SLUG)) {
    if (segments.includes(segment) && sections.some((s) => s.slug === parentSlug)) {
      return parentSlug;
    }
  }

  return sections[0]?.slug;
}
