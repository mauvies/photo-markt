/**
 * Role constants object for type-safe role usage across the codebase.
 * Use ROLES.PHOTOGRAPHER and ROLES.TALENT instead of string literals.
 */
export const ROLES = {
  PHOTOGRAPHER: 'PHOTOGRAPHER',
  TALENT: 'TALENT',
} as const;

/**
 * Array of all user roles (for backward compatibility and iteration).
 */
export const USER_ROLES = [ROLES.PHOTOGRAPHER, ROLES.TALENT] as const;

/**
 * Type representing a user role enum value.
 */
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Type representing a role slug (lowercase, URL-friendly).
 */
export type RoleSlug = 'photographer' | 'talent';

/**
 * Convert a role slug to a role enum value.
 */
export const roleSlugToEnum = (slug: RoleSlug): UserRole =>
  slug === 'photographer' ? ROLES.PHOTOGRAPHER : ROLES.TALENT;

/**
 * Convert a role enum value to a role slug.
 */
export const roleEnumToSlug = (role: UserRole): RoleSlug =>
  role === ROLES.PHOTOGRAPHER ? 'photographer' : 'talent';

/**
 * Resolve role switch logic to determine if talent role needs to be enabled.
 */
export function resolveRoleSwitch(
  existing: UserRole[],
  target: UserRole,
): {
  needsEnableTalent: boolean;
} {
  const normalized = new Set(existing);
  if (target === ROLES.TALENT && !normalized.has(ROLES.TALENT)) {
    return { needsEnableTalent: true };
  }
  return { needsEnableTalent: false };
}
