import type { RoleSlug } from '@/lib/roles';

/**
 * The dashboard home (overview) path for a given role's own dashboard.
 *
 * Use this for in-dashboard navigation (e.g. the logo) so the destination is
 * derived from the dashboard the user is *actually viewing* — not from
 * `profiles.active_role`, which is a mutable UI preference that can lag behind
 * (the role layouts gate by capability, so a user can view the photographer
 * dashboard while `active_role` still says `talent`). Routing the logo through
 * the public home let that stale `active_role` send a photographer to the
 * talent dashboard (T-061).
 */
export function dashboardHomeForRole(role: RoleSlug): string {
  return role === 'talent' ? '/dashboard/talent' : '/dashboard/photographer';
}

/**
 * Capability-validated destination for the `/dashboard` disambiguator.
 *
 * `/dashboard` normally trusts `active_role`, but if that preference points at
 * a role the user no longer holds it would bounce forever: the role layout
 * redirects an unheld role back to `/dashboard`, which sends them right back.
 * Falling back to a role the user actually holds breaks that loop (the crash
 * behind "el dashboard de talento revienta" in T-061).
 */
export function resolveDashboardHome(
  activeRole: RoleSlug | null,
  heldRoles: readonly RoleSlug[],
): string {
  if (activeRole && heldRoles.includes(activeRole)) {
    return dashboardHomeForRole(activeRole);
  }
  // `active_role` desynced from capabilities — send the user to a role they
  // can actually access instead of looping. Photographer is the default role.
  if (heldRoles.includes('photographer')) return '/dashboard/photographer';
  if (heldRoles.includes('talent')) return '/dashboard/talent';
  // No held roles at all → they haven't finished onboarding.
  return '/onboarding/role';
}
