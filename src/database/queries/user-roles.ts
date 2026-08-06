/**
 * User role-related database queries
 */

import type { UserRole } from '@/lib/roles';
import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface UserRoleMembership {
  user_id: string;
  role: UserRole;
  enabled_at?: string;
}

/**
 * Get all roles for a user
 */
export async function getUserRoles(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<UserRole[]> {
  const { data, error } = await supabase
    .from('user_role_memberships')
    .select('role')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to get user roles: ${getErrorMessage(error)}`);
  }

  return data?.map((r) => r.role as UserRole) ?? [];
}

/**
 * Any one role the user holds, or `null` if they hold none.
 *
 * Its only caller is the onboarding gate, which asks a yes/no question ("has
 * this user finished onboarding?") and never looks at *which* role comes back —
 * so returning an arbitrary one is correct. Use {@link getUserRoles} whenever
 * the answer matters.
 *
 * ⚠️ `limit(1)`, NOT `maybeSingle()` (T-235). `user_role_memberships` holds one
 * row **per role**, so a user with both roles has two — and `maybeSingle()`
 * fails on more than one row exactly as it does on none, with the same opaque
 * `PGRST116`. That made the onboarding page throw for precisely the users who
 * had completed onboarding twice over.
 */
export async function getUserRole(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<UserRole | null> {
  const { data, error } = await supabase
    .from('user_role_memberships')
    .select('role')
    .eq('user_id', userId)
    .limit(1);

  if (error) {
    throw new Error(`Failed to get user role: ${getErrorMessage(error)}`);
  }

  return (data?.[0]?.role as UserRole | undefined) ?? null;
}

/**
 * Add or update a user role membership
 */
export async function upsertUserRole(
  supabase: SupabaseServerClient,
  userId: string,
  role: UserRole,
): Promise<void> {
  const { error } = await supabase.from('user_role_memberships').upsert(
    { user_id: userId, role },
    {
      onConflict: 'user_id,role',
      ignoreDuplicates: false,
    },
  );

  if (error) {
    throw new Error(`Failed to upsert user role: ${getErrorMessage(error)}`);
  }
}
