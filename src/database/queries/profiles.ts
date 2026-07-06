/**
 * Profile-related database queries
 */

import type { UserRole } from '@/lib/roles';
import { normalizeUsername } from '@/lib/username';
import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface Profile {
  id: string;
  display_name?: string | null;
  username: string;
  slug?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  active_role: UserRole;
  full_name?: string | null;
  country_code?: string | null;
  city?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  state_or_region?: string | null;
  postal_code?: string | null;
  payout_method?: 'bank_transfer' | 'paypal' | 'other' | null;
  payout_details_json?: Record<string, unknown> | null;
  is_payout_profile_complete?: boolean;
  stripe_connect_account_id?: string | null;
  stripe_connect_status?: 'not_connected' | 'pending' | 'active' | 'restricted';
  created_at?: string;
  updated_at?: string;
}

export interface ProfileSelect {
  display_name?: string | null;
  username: string;
  active_role?: UserRole | null;
  bio?: string | null;
  full_name?: string | null;
  country_code?: string | null;
  city?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  state_or_region?: string | null;
  postal_code?: string | null;
  payout_method?: 'bank_transfer' | 'paypal' | 'other' | null;
  payout_details_json?: Record<string, unknown> | null;
  is_payout_profile_complete?: boolean;
}

/**
 * Get a user's profile by ID
 */
export async function getProfile(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get profile: ${getErrorMessage(error)}`);
  }

  return data as Profile | null;
}

/**
 * Resolve display names for a set of profile ids in one query. Backs uploader
 * attribution on the event pages and load-more actions — a single lookup keyed
 * by id instead of the inline `.from('profiles').in('id', …)` those call sites
 * repeated. Returns an empty map for an empty id list; throws on query error.
 */
export async function getProfilesByIds(
  supabase: SupabaseServerClient,
  ids: string[],
): Promise<Record<string, { display_name: string | null; username: string }>> {
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, username')
    .in('id', ids);

  if (error) {
    throw new Error(`Failed to get profiles by ids: ${getErrorMessage(error)}`);
  }

  const map: Record<string, { display_name: string | null; username: string }> = {};
  for (const row of data ?? []) {
    map[row.id as string] = {
      display_name: (row.display_name as string | null) ?? null,
      username: row.username as string,
    };
  }
  return map;
}

/**
 * Get specific fields from a user's profile
 */
export async function getProfileFields<T extends keyof ProfileSelect>(
  supabase: SupabaseServerClient,
  userId: string,
  fields: T[],
): Promise<Pick<ProfileSelect, T> | null> {
  const selectFields = fields.join(', ');
  const { data, error } = await supabase
    .from('profiles')
    .select(selectFields)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get profile fields: ${getErrorMessage(error)}`);
  }

  return data as Pick<ProfileSelect, T> | null;
}

/**
 * Get a user's active role from their profile
 */
export async function getProfileActiveRole(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<UserRole | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('active_role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get active role: ${getErrorMessage(error)}`);
  }

  return (data?.active_role as UserRole) ?? null;
}

/**
 * Turn a raw base string into a valid, currently-available username:
 * normalize to the username format, pad short values, cap at 30 chars, then
 * append a numeric suffix (`_1`, `_2`, …) until the value is free.
 *
 * Shared by the email-derived fallback and the onboarding suggestion so the
 * uniqueness rule lives in one place.
 */
async function ensureUniqueUsername(
  supabase: SupabaseServerClient,
  rawBase: string,
): Promise<string> {
  let baseUsername = normalizeUsername(rawBase);

  // Ensure minimum length
  if (baseUsername.length < 3) {
    baseUsername = `${baseUsername}_user`;
  }

  // Limit to 30 characters
  if (baseUsername.length > 30) {
    baseUsername = baseUsername.substring(0, 30);
  }

  // Check for uniqueness and append number if needed
  let finalUsername = baseUsername;
  let counter = 0;
  while (true) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', finalUsername)
      .maybeSingle();

    if (!existing) {
      break; // Username is unique
    }

    counter++;
    const counterStr = counter.toString();
    if (baseUsername.length + counterStr.length + 1 > 30) {
      finalUsername = `${baseUsername.substring(0, 30 - counterStr.length - 1)}_${counterStr}`;
    } else {
      finalUsername = `${baseUsername}_${counterStr}`;
    }
  }

  return finalUsername;
}

/**
 * Generate a unique username from email
 */
async function generateUsernameFromEmail(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<string> {
  // Get user email using RPC function
  const { data: userEmails, error: emailError } = await supabase.rpc('get_user_emails_batch', {
    user_ids: [userId],
  });

  if (emailError || !userEmails || userEmails.length === 0 || !userEmails[0]?.email) {
    throw new Error(
      `Failed to get user email for username generation: ${getErrorMessage(emailError)}`,
    );
  }

  // Use the local-part, mapping dots to underscores so `john.doe` -> `john_doe`.
  const base = userEmails[0].email.toLowerCase().split('@')[0].replace(/\./g, '_');
  return ensureUniqueUsername(supabase, base);
}

/**
 * Suggest a valid, currently-available username to pre-fill the onboarding
 * field. Prefers the user's display name (e.g. a Google `full_name`), falling
 * back to the email local-part when no usable name exists.
 */
export async function getSuggestedUsername(
  supabase: SupabaseServerClient,
  { fullName, email }: { fullName?: string | null; email?: string | null },
): Promise<string> {
  const nameBase = fullName ? normalizeUsername(fullName) : '';
  if (nameBase.length >= 3) {
    return ensureUniqueUsername(supabase, nameBase);
  }

  const emailLocal = email ? email.toLowerCase().split('@')[0].replace(/\./g, '_') : '';
  return ensureUniqueUsername(supabase, emailLocal || 'user');
}

/**
 * Update or insert a profile's active role.
 *
 * When `username` is supplied (the onboarding path), it is persisted verbatim
 * together with `slug` so the chosen value is never clobbered by the
 * email-derived fallback. The caller is responsible for normalizing and
 * uniqueness-checking that value first (see `completeOnboarding`).
 *
 * When `username` is omitted, the existing username is preserved, or — for a
 * brand-new profile with no row yet — one is generated from the user's email
 * to satisfy the NOT NULL constraint.
 */
export async function upsertProfileRole(
  supabase: SupabaseServerClient,
  userId: string,
  role: UserRole,
  username?: string,
): Promise<void> {
  // Determine the username + slug to persist.
  let resolvedUsername: string;
  let slug: string | undefined;

  if (username) {
    // Onboarding path: persist the user's chosen username and mirror it to
    // slug so public photographer URLs resolve immediately.
    resolvedUsername = username;
    slug = username;
  } else {
    // Role-switch path: keep the existing username, or generate one for a
    // profile that doesn't exist yet.
    const existingProfile = await getProfile(supabase, userId);
    resolvedUsername = existingProfile?.username
      ? existingProfile.username
      : await generateUsernameFromEmail(supabase, userId);
  }

  // Upsert with username and role (always include username to satisfy NOT NULL
  // constraint). Spread a typed Partial<Profile> rather than an inline literal
  // so the optional `slug` column doesn't trip excess-property checks against
  // the generated row type (mirrors `upsertProfile`).
  const fields: Partial<Profile> = { active_role: role, username: resolvedUsername };
  if (slug) fields.slug = slug;

  let { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...fields }, { onConflict: 'id', ignoreDuplicates: false });

  // Some environments don't have the `slug` column (schema drift between the
  // cloud DB, which has it, and a stripped-down local DB). When that's the
  // only problem, the username still mirrors to slug everywhere it's read via
  // a `slug ?? username` fallback, so retry without slug rather than failing
  // onboarding outright.
  if (error && slug && isMissingSlugColumn(error)) {
    const { slug: _slug, ...withoutSlug } = fields;
    ({ error } = await supabase
      .from('profiles')
      .upsert({ id: userId, ...withoutSlug }, { onConflict: 'id', ignoreDuplicates: false }));
  }

  if (error) {
    throw new Error(`Failed to upsert profile role: ${getErrorMessage(error)}`);
  }
}

/** True when a Supabase error reports the `slug` column is absent from `profiles`. */
function isMissingSlugColumn(error: { code?: string; message?: string }): boolean {
  // 42703 = undefined_column (Postgres); PGRST204 = column missing from
  // PostgREST schema cache. Both mention `slug` in the message.
  return /slug/i.test(error.message ?? '') && (error.code === '42703' || error.code === 'PGRST204');
}

/**
 * Update profile fields
 */
export async function updateProfile(
  supabase: SupabaseServerClient,
  userId: string,
  updates: Partial<
    Pick<
      Profile,
      | 'display_name'
      | 'username'
      | 'slug'
      | 'bio'
      | 'avatar_url'
      | 'full_name'
      | 'country_code'
      | 'city'
      | 'address_line1'
      | 'address_line2'
      | 'state_or_region'
      | 'postal_code'
      | 'payout_method'
      | 'payout_details_json'
      | 'is_payout_profile_complete'
    >
  >,
): Promise<void> {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId);

  if (error) {
    throw new Error(`Failed to update profile: ${getErrorMessage(error)}`);
  }
}

export type StripeConnectStatus = 'not_connected' | 'pending' | 'active' | 'restricted';

/**
 * Get Stripe Connect fields for a photographer
 */
export async function getProfileStripeConnect(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<{
  stripe_connect_account_id: string | null;
  stripe_connect_status: StripeConnectStatus;
} | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_status')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get connect status: ${getErrorMessage(error)}`);
  }

  if (!data) return null;
  return {
    stripe_connect_account_id: data.stripe_connect_account_id ?? null,
    stripe_connect_status: (data.stripe_connect_status ?? 'not_connected') as StripeConnectStatus,
  };
}

/**
 * Update Stripe Connect fields on a profile
 */
export async function updateProfileStripeConnect(
  supabase: SupabaseServerClient,
  userId: string,
  data: { stripe_connect_account_id?: string; stripe_connect_status?: StripeConnectStatus },
): Promise<void> {
  const { error } = await supabase.from('profiles').update(data).eq('id', userId);

  if (error) {
    throw new Error(`Failed to update connect status: ${getErrorMessage(error)}`);
  }
}

/**
 * Find a profile by Stripe Connect account ID (used in webhook account.updated handler)
 */
export async function getProfileByStripeConnectAccountId(
  supabase: SupabaseServerClient,
  accountId: string,
): Promise<{ id: string; stripe_connect_status: StripeConnectStatus } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, stripe_connect_status')
    .eq('stripe_connect_account_id', accountId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find profile by connect account: ${getErrorMessage(error)}`);
  }

  if (!data) return null;
  return {
    id: data.id,
    stripe_connect_status: (data.stripe_connect_status ?? 'not_connected') as StripeConnectStatus,
  };
}

/**
 * Get Stripe Connect statuses for multiple photographers (used at checkout to block unconnected)
 */
export async function getPhotographerConnectStatuses(
  supabase: SupabaseServerClient,
  photographerIds: string[],
): Promise<
  Array<{
    id: string;
    stripe_connect_account_id: string | null;
    stripe_connect_status: StripeConnectStatus;
  }>
> {
  if (photographerIds.length === 0) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, stripe_connect_account_id, stripe_connect_status')
    .in('id', photographerIds);

  if (error) {
    throw new Error(`Failed to get connect statuses: ${getErrorMessage(error)}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    stripe_connect_account_id: row.stripe_connect_account_id ?? null,
    stripe_connect_status: (row.stripe_connect_status ?? 'not_connected') as StripeConnectStatus,
  }));
}

/**
 * Upsert profile (update or insert)
 */
export async function upsertProfile(
  supabase: SupabaseServerClient,
  userId: string,
  profile: Partial<Profile>,
): Promise<void> {
  const { error } = await supabase.from('profiles').upsert(
    { id: userId, ...profile },
    {
      onConflict: 'id',
      ignoreDuplicates: false,
    },
  );

  if (error) {
    throw new Error(`Failed to upsert profile: ${getErrorMessage(error)}`);
  }
}
