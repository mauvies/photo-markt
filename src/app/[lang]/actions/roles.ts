'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  upsertProfileRole as dbUpsertProfileRole,
  upsertUserRole as dbUpsertUserRole,
  getProfileActiveRole,
  getUserRoles,
} from '@/database/queries';
import { createClient, getUser } from '@/database/server';
import { type PlanIntent, planIntentResumePath } from '@/lib/billing/plan-intent';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedRedirect } from '@/lib/i18n/redirect';
import type { RoleActionErrorCode } from '@/lib/role-action-error';
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

/**
 * Outcome of a role mutation. Returned, never thrown (T-234): Next redacts
 * thrown Server Action messages in production (the T-189 finding), so a `throw`
 * cannot tell the user anything — and a role switch that fails without saying
 * why is exactly the reported bug. Same discriminated-union shape as
 * `AvatarActionResult` (`actions/avatar.ts`). The codes and their copy live in
 * `lib/role-action-error.ts` so the client components can read them too.
 */
export type RoleActionResult =
  | { ok: true; activeRole: RoleSlug }
  | { ok: false; error: RoleActionErrorCode };

/**
 * Non-throwing counterpart of {@link getAuthenticatedClient}, for the actions
 * that report failure through {@link RoleActionResult} instead of throwing.
 */
async function getAuthenticatedClientOrNull() {
  const [supabase, user] = await Promise.all([createClient(), getUser()]);
  return user ? { supabase, user } : null;
}

async function getAuthenticatedClient() {
  const authed = await getAuthenticatedClientOrNull();
  if (!authed) {
    throw new Error('You must be signed in to manage roles.');
  }
  return authed;
}

/**
 * Grant `role` to a user and make it their active view. Both writes together:
 * the membership is the capability, `active_role` is the view preference, and
 * granting one without the other leaves a user who holds a role they can't see.
 */
async function enableRoleInternal(
  supabase: SupabaseServerClient,
  userId: string,
  role: UserRole,
): Promise<void> {
  await dbUpsertUserRole(supabase, userId, role);
  await dbUpsertProfileRole(supabase, userId, role);
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
 *
 * `checkoutIntent` carries a plan chosen before signup. When present and the
 * user onboarded as a **photographer**, we redirect into the server-validated
 * resume path (which starts Stripe checkout for a paid plan, or lands on the
 * overview for Free) instead of the plain dashboard — preserving the intent
 * through onboarding. A talent onboarding ignores it (a plan only applies to
 * photographers).
 */
export async function completeOnboarding(
  initialRole: UserRole,
  username?: string,
  checkoutIntent?: PlanIntent,
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
  const lang = await getLangFromHeaders();

  // Resume a pre-signup plan intent for a new photographer. `planIntentResumePath`
  // returns an internal path only (Stripe checkout resume for paid, overview for
  // Free) — never a raw redirect target.
  if (checkoutIntent && role === ROLES.PHOTOGRAPHER) {
    localizedRedirect(lang, planIntentResumePath(checkoutIntent));
  }

  const dashboardPath = role === ROLES.TALENT ? '/dashboard/talent' : '/dashboard/photographer';
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

function revalidateDashboards(): void {
  revalidatePath('/es/dashboard');
  revalidatePath('/en/dashboard');
  revalidatePath('/es/dashboard/talent');
  revalidatePath('/en/dashboard/talent');
  revalidatePath('/es/dashboard/photographer');
  revalidatePath('/en/dashboard/photographer');
}

/**
 * Grant the current user a role they don't hold yet and switch them into it.
 *
 * **Why this is safe to expose as a one-click action (T-234):** a role here is
 * a self-service *capability*, not an authorization tier — anyone can pick
 * either one at onboarding with no verification, so granting it later opens
 * nothing that wasn't already one signup away. It touches neither `admin_users`
 * (the actual privilege table) nor billing: a fresh photographer lands on Free.
 *
 * This is deliberately **separate from {@link switchRole}**, whose "you cannot
 * switch to a role you were never granted" guard is a documented invariant
 * pinned by `test/integration/actions/roles.test.ts`. Becoming a photographer
 * is a different intent from switching between roles you already hold, and the
 * UI says so too ("Become a photographer" vs "Switch to photographer").
 */
async function enableRoleAction(role: UserRole): Promise<RoleActionResult> {
  const authed = await getAuthenticatedClientOrNull();
  if (!authed) return { ok: false, error: 'not_signed_in' };

  try {
    await enableRoleInternal(authed.supabase, authed.user.id, role);
  } catch (err) {
    console.error('[enableRoleAction] failed to grant role', { role, err });
    return { ok: false, error: 'failed' };
  }

  revalidateDashboards();
  return { ok: true, activeRole: roleEnumToSlug(role) };
}

/** Enable the talent role for the current user if not already present. */
export async function enableTalentRole(): Promise<RoleActionResult> {
  return enableRoleAction(ROLES.TALENT);
}

/**
 * Enable the photographer role for the current user. The mirror of
 * {@link enableTalentRole} — before T-234 a talent-only user had no path to
 * ever become a photographer, while the account menu offered them a switch that
 * could only fail.
 */
export async function enablePhotographerRole(): Promise<RoleActionResult> {
  return enableRoleAction(ROLES.PHOTOGRAPHER);
}

/**
 * Switch the active role for the current user, enabling talent if needed.
 *
 * Refuses a role the user does not hold (talent's auto-enable is the one
 * documented exception). Granting a role is {@link enablePhotographerRole} /
 * {@link enableTalentRole} — a separate, explicit intent.
 */
export async function switchRole(
  input: RoleSlug,
  options?: { skipRevalidation?: boolean },
): Promise<RoleActionResult> {
  const parsed = roleSlugSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_role' };
  const slug = parsed.data;
  const targetRole = roleSlugToEnum(slug);

  const authed = await getAuthenticatedClientOrNull();
  if (!authed) return { ok: false, error: 'not_signed_in' };
  const { supabase, user } = authed;

  try {
    const existingRoles = await getUserRoles(supabase, user.id);
    const { needsEnableTalent } = resolveRoleSwitch(existingRoles, targetRole);

    if (needsEnableTalent) {
      await enableRoleInternal(supabase, user.id, ROLES.TALENT);
    } else {
      if (!existingRoles.includes(targetRole)) {
        return { ok: false, error: 'role_not_held' };
      }
      await dbUpsertProfileRole(supabase, user.id, targetRole);
    }
  } catch (err) {
    console.error('[switchRole] failed to switch role', { slug, err });
    return { ok: false, error: 'failed' };
  }

  // Only revalidate if not called during render (e.g., from user action)
  if (!options?.skipRevalidation) {
    revalidateDashboards();
  }

  return { ok: true, activeRole: slug };
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
