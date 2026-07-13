import { ROLES, type UserRole } from '@/lib/roles';

/**
 * Dashboard path an authenticated visitor to the public home should be sent to,
 * or `null` to stay on the public home.
 *
 * Photographer → dashboard overview. Talent (T-118) → `null`: the public home
 * IS the talent home now (unified landing/explore), so an already-onboarded
 * talent stays on `/` instead of bouncing to a dashboard route. A `null`/unknown
 * role (not yet onboarded) still redirects to the talent dashboard, which
 * itself gates roleless users to `/onboarding/role` — that funnel is
 * unaffected by this change.
 */
export function homeRedirectPath(
  isAuthenticated: boolean,
  role: UserRole | null | undefined,
): string | null {
  if (!isAuthenticated) return null;
  if (role === ROLES.TALENT) return null;
  return role === ROLES.PHOTOGRAPHER ? '/dashboard/photographer' : '/dashboard/talent';
}
