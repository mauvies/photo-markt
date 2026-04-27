'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  upsertProfileRole as dbUpsertProfileRole,
  upsertUserRole as dbUpsertUserRole,
  getProfileActiveRole,
  getUserRoles,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedRedirect } from '@/lib/i18n/redirect';
import {
  ROLES,
  type RoleSlug,
  resolveRoleSwitch,
  roleEnumToSlug,
  roleSlugToEnum,
  type UserRole,
} from '@/lib/roles';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const userRoleSchema = z.enum([ROLES.PHOTOGRAPHER, ROLES.TALENT]);
const roleSlugSchema = z.enum(['photographer', 'talent']);

type SwitchRoleResult = {
  activeRole: RoleSlug;
};

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to manage roles.');
  }

  return { supabase, user };
}

async function enableTalentRoleInternal(supabase: SupabaseServerClient, userId: string) {
  await dbUpsertUserRole(supabase, userId, ROLES.TALENT);
  await dbUpsertProfileRole(supabase, userId, ROLES.TALENT);
}

export async function completeOnboarding(initialRole: UserRole, username?: string) {
  const role = userRoleSchema.parse(initialRole);
  const { supabase, user } = await getAuthenticatedClient();

  // Update profile with username
  if (username) {
    const { updateProfile } = await import('@/database/queries');
    await updateProfile(supabase, user.id, { username });
  }

  await dbUpsertProfileRole(supabase, user.id, role);
  await dbUpsertUserRole(supabase, user.id, role);

  revalidatePath('/es/dashboard');
  revalidatePath('/en/dashboard');
  // Redirect to the role-specific dashboard
  const dashboardPath = role === ROLES.TALENT ? '/dashboard/talent' : '/dashboard/photographer';
  const lang = await getLangFromHeaders();
  localizedRedirect(lang, dashboardPath);
}

export async function enableTalentRole(): Promise<SwitchRoleResult> {
  const { supabase, user } = await getAuthenticatedClient();
  await enableTalentRoleInternal(supabase, user.id);

  revalidatePath('/es/dashboard');
  revalidatePath('/en/dashboard');
  revalidatePath('/es/dashboard/talent');
  revalidatePath('/en/dashboard/talent');

  return { activeRole: roleEnumToSlug(ROLES.TALENT) };
}

export async function switchRole(
  input: RoleSlug,
  options?: { skipRevalidation?: boolean },
): Promise<SwitchRoleResult> {
  const slug = roleSlugSchema.parse(input);
  const targetRole = roleSlugToEnum(slug);
  const { supabase, user } = await getAuthenticatedClient();

  const existingRoles = await getUserRoles(supabase, user.id);
  const { needsEnableTalent } = resolveRoleSwitch(existingRoles, targetRole);

  if (needsEnableTalent) {
    await enableTalentRoleInternal(supabase, user.id);
  } else {
    const hasRole = existingRoles.includes(targetRole);
    if (!hasRole) {
      throw new Error('Role is not enabled for this user.');
    }
    await dbUpsertProfileRole(supabase, user.id, targetRole);
  }

  // Only revalidate if not called during render (e.g., from user action)
  if (!options?.skipRevalidation) {
    revalidatePath('/es/dashboard');
    revalidatePath('/en/dashboard');
    revalidatePath('/es/dashboard/talent');
    revalidatePath('/en/dashboard/talent');
    revalidatePath('/es/dashboard/photographer');
    revalidatePath('/en/dashboard/photographer');
  }

  return { activeRole: slug };
}

export async function getActiveRole(): Promise<{
  activeRole: RoleSlug;
}> {
  const { supabase, user } = await getAuthenticatedClient();

  // If profile exists, it should always have an active_role (NOT NULL with default)
  // Use it directly if present
  const activeRole = await getProfileActiveRole(supabase, user.id);
  if (activeRole) {
    return { activeRole: roleEnumToSlug(activeRole) };
  }

  // Profile doesn't exist - check user roles to determine what to set
  const rolesData = await getUserRoles(supabase, user.id);

  // Prefer PHOTOGRAPHER as fallback (default role), then TALENT, then first available
  const fallback =
    rolesData.find((role) => role === ROLES.PHOTOGRAPHER) ??
    rolesData.find((role) => role === ROLES.TALENT) ??
    rolesData[0] ??
    (ROLES.PHOTOGRAPHER as UserRole);

  // Create/update profile with the fallback role
  await dbUpsertProfileRole(supabase, user.id, fallback);

  return { activeRole: roleEnumToSlug(fallback) };
}

/**
 * Gets the dashboard path for the user's active role
 * @returns The dashboard path (e.g., "/dashboard/talent" or "/dashboard/photographer")
 */
export async function getDashboardPath(): Promise<string> {
  const { activeRole } = await getActiveRole();
  return activeRole === 'talent' ? '/dashboard/talent/events' : '/dashboard/photographer';
}
