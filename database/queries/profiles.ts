/**
 * Profile-related database queries
 */

import type { UserRole } from '@/lib/roles';
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

  // Generate username from email
  const email = userEmails[0].email;
  let baseUsername = email.toLowerCase().split('@')[0];
  baseUsername = baseUsername.replace(/\./g, '_');
  baseUsername = baseUsername.replace(/[^a-z0-9_-]/g, '');

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
 * Update or insert a profile's active role
 */
export async function upsertProfileRole(
  supabase: SupabaseServerClient,
  userId: string,
  role: UserRole,
): Promise<void> {
  // Check if profile exists
  const existingProfile = await getProfile(supabase, userId);

  // Determine username: use existing or generate new one
  let username: string;
  if (existingProfile?.username) {
    username = existingProfile.username;
  } else {
    // Generate username from email
    username = await generateUsernameFromEmail(supabase, userId);
  }

  // Upsert with username and role (always include username to satisfy NOT NULL constraint)
  const { error } = await supabase.from('profiles').upsert(
    { id: userId, active_role: role, username },
    {
      onConflict: 'id',
      ignoreDuplicates: false,
    },
  );

  if (error) {
    throw new Error(`Failed to upsert profile role: ${getErrorMessage(error)}`);
  }
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
