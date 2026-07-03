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
import { isValidUsername, normalizeUsername } from '@/lib/username';

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

/** Recoverable failure outcome from {@link completeOnboarding}. Success redirects and never returns. */
export type CompleteOnboardingResult = { error: 'username_invalid' | 'username_taken' };

/** True when a Postgres error reflects a unique-constraint violation (code 23505). */
function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /23505|duplicate key|already exists/i.test(message);
}

/**
 * Finish onboarding: assign the chosen role and persist the chosen username,
 * then redirect to the role's dashboard.
 *
 * The username is normalized, format-checked, and uniqueness-checked before a
 * single upsert writes `active_role`, `username`, and `slug` together — so the
 * chosen value can't be clobbered by the email-derived fallback. A TOCTOU
 * unique-violation is mapped to the same friendly "taken" outcome.
 *
 * Returns a {@link CompleteOnboardingResult} on recoverable failure; on success
 * it redirects (throws NEXT_REDIRECT) and does not return.
 */
export async function completeOnboarding(
  initialRole: UserRole,
  username?: string,
): Promise<CompleteOnboardingResult | undefined> {
  const role = userRoleSchema.parse(initialRole);
  const { supabase, user } = await getAuthenticatedClient();

  let normalizedUsername: string | undefined;
  if (username !== undefined) {
    normalizedUsername = normalizeUsername(username);
    if (!isValidUsername(normalizedUsername)) {
      return { error: 'username_invalid' };
    }

    // Uniqueness check mirroring updateProfileAction: a user never collides
    // with their own current username.
    const { data: existingProfile, error: lookupError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', normalizedUsername)
      .neq('id', user.id)
      .maybeSingle();
    if (lookupError) {
      throw new Error(`Failed to check username availability: ${lookupError.message}`);
    }
    if (existingProfile) {
      return { error: 'username_taken' };
    }
  }

  try {
    await dbUpsertProfileRole(supabase, user.id, role, normalizedUsername);
  } catch (error) {
    // Defense-in-depth: another request may have claimed the username between
    // our check and this write (TOCTOU). Map the unique violation to the same
    // friendly "taken" outcome instead of throwing a 500.
    if (normalizedUsername && isUniqueViolation(error)) {
      return { error: 'username_taken' };
    }
    throw error;
  }

  await dbUpsertUserRole(supabase, user.id, role);

  revalidatePath('/es/dashboard');
  revalidatePath('/en/dashboard');
  const dashboardPath = role === ROLES.TALENT ? '/dashboard/talent' : '/dashboard/photographer';
  const lang = await getLangFromHeaders();
  localizedRedirect(lang, dashboardPath);
}

/** Result of {@link checkUsernameAvailability}. */
export type UsernameAvailability = { available: boolean; reason?: 'invalid' | 'taken' };

/**
 * Report whether a candidate username is free for the current user, applying
 * the same normalization and format rules as {@link completeOnboarding}. The
 * user's own current username counts as available.
 */
export async function checkUsernameAvailability(candidate: string): Promise<UsernameAvailability> {
  const normalized = normalizeUsername(candidate);
  if (!isValidUsername(normalized)) {
    return { available: false, reason: 'invalid' };
  }

  const { supabase, user } = await getAuthenticatedClient();
  const { data: existingProfile, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', normalized)
    .neq('id', user.id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to check username availability: ${error.message}`);
  }

  return existingProfile ? { available: false, reason: 'taken' } : { available: true };
}

/** Enable the talent role for the current user if not already present. */
export async function enableTalentRole(): Promise<SwitchRoleResult> {
  const { supabase, user } = await getAuthenticatedClient();
  await enableTalentRoleInternal(supabase, user.id);

  revalidatePath('/es/dashboard');
  revalidatePath('/en/dashboard');
  revalidatePath('/es/dashboard/talent');
  revalidatePath('/en/dashboard/talent');

  return { activeRole: roleEnumToSlug(ROLES.TALENT) };
}

/** Switch the active role for the current user, enabling talent if needed. */
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

/**
 * Resolve the current user's active role as a slug, or `null` when they have
 * not onboarded yet (no profile row). Pure read — performs NO write. Use this
 * for routing/gating: a `null` result means "send the user to onboarding."
 */
export async function getActiveRoleOrNull(): Promise<RoleSlug | null> {
  const { supabase, user } = await getAuthenticatedClient();
  const activeRole = await getProfileActiveRole(supabase, user.id);
  return activeRole ? roleEnumToSlug(activeRole) : null;
}

/**
 * Whether the current user *holds* the given role (capability), independent of
 * which dashboard they are currently viewing. Use this to gate role-specific
 * actions — never `active_role`, which is a mutable UI preference. Pure read.
 */
export async function userHasRole(slug: RoleSlug): Promise<boolean> {
  const { supabase, user } = await getAuthenticatedClient();
  const roles = await getUserRoles(supabase, user.id);
  return roles.includes(roleSlugToEnum(slug));
}

/**
 * Read both the active role preference and the set of *held* roles in a single
 * auth round-trip. Use this for routing decisions that need to reconcile the
 * two (e.g. the `/dashboard` disambiguator) instead of calling
 * `getActiveRoleOrNull` + `userHasRole` separately, which re-authenticates and
 * re-queries `user_roles` per call. Pure read.
 */
export async function getRoleContext(): Promise<{
  activeRole: RoleSlug | null;
  heldRoles: RoleSlug[];
}> {
  const { supabase, user } = await getAuthenticatedClient();
  const [activeRole, roles] = await Promise.all([
    getProfileActiveRole(supabase, user.id),
    getUserRoles(supabase, user.id),
  ]);
  return {
    activeRole: activeRole ? roleEnumToSlug(activeRole) : null,
    heldRoles: roles.map(roleEnumToSlug),
  };
}

/**
 * Return the active role for the current user, falling back to photographer if
 * none is set.
 *
 * Pure read — it does NOT create or modify a profile. Resolving a role must
 * never mint a default profile (that would silently bypass onboarding and
 * stamp an email-derived username); profile creation lives only in
 * `completeOnboarding` / `switchRole` / `enableTalentRole`. Callers that need
 * to distinguish "not onboarded yet" should use `getActiveRoleOrNull`.
 */
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

  // Profile doesn't exist - check user roles to determine the fallback to
  // report. We do NOT persist it; that happens only on explicit onboarding /
  // role-switch writes.
  const rolesData = await getUserRoles(supabase, user.id);

  // Prefer PHOTOGRAPHER as fallback (default role), then TALENT, then first available
  const fallback =
    rolesData.find((role) => role === ROLES.PHOTOGRAPHER) ??
    rolesData.find((role) => role === ROLES.TALENT) ??
    rolesData[0] ??
    (ROLES.PHOTOGRAPHER as UserRole);

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
