import { ROLES, type UserRole } from '@/lib/roles';

/**
 * Dashboard path an authenticated visitor to the public home should be sent to,
 * or `null` to stay on the public home (anonymous visitors).
 *
 * Photographer → dashboard overview. Anyone else (talent, or unknown role) →
 * the talent dashboard, which itself forwards to the explore/events tab.
 */
export function homeRedirectPath(
  isAuthenticated: boolean,
  role: UserRole | null | undefined,
): string | null {
  if (!isAuthenticated) return null;
  return role === ROLES.PHOTOGRAPHER ? '/dashboard/photographer' : '/dashboard/talent';
}
