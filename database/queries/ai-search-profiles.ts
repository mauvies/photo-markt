/**
 * AI Search Profiles database queries
 * For managing talent AI search profiles and presets.
 *
 * Note: the historical `selfie_embedding` column was dropped in
 * 20260518000000_drop_legacy_ai_schema.sql — under the new AWS Rekognition
 * design, selfies are sent live to `SearchFacesByImage` per request and
 * never persisted. Profiles now hold only filters (activity, country,
 * region, date range) + a name.
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface AISearchProfile {
  id: string;
  user_id: string;
  name: string;
  activity_type: string | null;
  country: string | null;
  region: string | null;
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAISearchProfileInput {
  name: string;
  activity_type?: string | null;
  country?: string | null;
  region?: string | null;
  date_from?: string | null;
  date_to?: string | null;
}

export interface UpdateAISearchProfileInput {
  name?: string;
  activity_type?: string | null;
  country?: string | null;
  region?: string | null;
  date_from?: string | null;
  date_to?: string | null;
}

/**
 * Get all AI search profiles for a user
 */
export async function getAISearchProfiles(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<AISearchProfile[]> {
  const { data, error } = await supabase
    .from('ai_search_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get AI search profiles: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as AISearchProfile[];
}

/**
 * Get a single AI search profile by ID
 */
export async function getAISearchProfile(
  supabase: SupabaseServerClient,
  profileId: string,
  userId: string,
): Promise<AISearchProfile | null> {
  const { data, error } = await supabase
    .from('ai_search_profiles')
    .select('*')
    .eq('id', profileId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get AI search profile: ${getErrorMessage(error)}`);
  }

  return (data ?? null) as AISearchProfile | null;
}

/**
 * Create a new AI search profile
 */
export async function createAISearchProfile(
  supabase: SupabaseServerClient,
  userId: string,
  input: CreateAISearchProfileInput,
): Promise<AISearchProfile> {
  const { data, error } = await supabase
    .from('ai_search_profiles')
    .insert({
      user_id: userId,
      name: input.name,
      activity_type: input.activity_type ?? null,
      country: input.country ?? null,
      region: input.region ?? null,
      date_from: input.date_from ?? null,
      date_to: input.date_to ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create AI search profile: ${getErrorMessage(error)}`);
  }

  return data as AISearchProfile;
}

/**
 * Update an AI search profile
 */
export async function updateAISearchProfile(
  supabase: SupabaseServerClient,
  profileId: string,
  userId: string,
  input: UpdateAISearchProfileInput,
): Promise<AISearchProfile> {
  const updateData: Record<string, unknown> = {};

  if (input.name !== undefined) {
    updateData.name = input.name;
  }
  if (input.activity_type !== undefined) {
    updateData.activity_type = input.activity_type;
  }
  if (input.country !== undefined) {
    updateData.country = input.country;
  }
  if (input.region !== undefined) {
    updateData.region = input.region;
  }
  if (input.date_from !== undefined) {
    updateData.date_from = input.date_from;
  }
  if (input.date_to !== undefined) {
    updateData.date_to = input.date_to;
  }

  const { data, error } = await supabase
    .from('ai_search_profiles')
    .update(updateData)
    .eq('id', profileId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update AI search profile: ${getErrorMessage(error)}`);
  }

  return data as AISearchProfile;
}

/**
 * Delete an AI search profile
 */
export async function deleteAISearchProfile(
  supabase: SupabaseServerClient,
  profileId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('ai_search_profiles')
    .delete()
    .eq('id', profileId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete AI search profile: ${getErrorMessage(error)}`);
  }
}
