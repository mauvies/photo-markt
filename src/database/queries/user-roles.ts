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
 * Get a single role for a user
 */
export async function getUserRole(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<UserRole | null> {
  const { data, error } = await supabase
    .from('user_role_memberships')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get user role: ${getErrorMessage(error)}`);
  }

  return (data?.role as UserRole) ?? null;
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
