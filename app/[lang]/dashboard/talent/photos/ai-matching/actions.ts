'use server';

// Server actions for the talent-side AI matching UI. The feature is gated
// behind `AI_MATCHING` in `lib/feature-flags.ts` (currently false) so the
// UI never reaches this file at runtime. PR 1 of the Rekognition rebuild
// (current) ripped out the dead CLIP/Replicate dependencies; `runAISimilaritySearch`
// is stubbed to throw until PR 3 wires up AWS SearchFacesByImage + the new
// `photo_faces` point-lookup.

import {
  createAISearchProfile,
  deleteAISearchProfile,
  getAISearchProfile,
  getAISearchProfiles,
  updateAISearchProfile,
} from '@/database/queries/ai-search-profiles';
import { getAISearchUsageCount } from '@/database/queries/ai-search-usage';
import { getProfile } from '@/database/queries/profiles';
import { getSubscription } from '@/database/queries/subscriptions';
import { tagPhotosForTalent } from '@/database/queries/talent-photo-tags';
import { createClient } from '@/database/server';
import { getRateLimitForPlan, hasExceededRateLimit } from '@/lib/ai/rate-limits';
import type { PlanId } from '@/lib/plans';

// Local filter shape used by callers — historically imported from the
// now-deleted `ai-similarity-search` module. Kept here so existing UI
// imports of this file keep type-checking until PR 3 reshapes the search API.
export interface SimilaritySearchFilters {
  activity_type?: string | null;
  country?: string | null;
  region?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  min_similarity?: number;
  limit?: number;
}

export interface AISearchProfile {
  id: string;
  name: string;
  activity_type: string | null;
  country: string | null;
  region: string | null;
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimilarityMatch {
  photo_id: string;
  similarity_score: number;
  photo_url: string | null;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
  event_city: string | null;
  event_country: string | null;
  photographer_id: string;
  photographer_username: string | null;
  photographer_display_name: string | null;
}

export interface CreateAISearchProfileInput {
  name: string;
  selfieFile?: File;
  activity_type?: string | null;
  country?: string | null;
  region?: string | null;
  date_from?: string | null;
  date_to?: string | null;
}

export interface UpdateAISearchProfileInput {
  name?: string;
  selfieFile?: File;
  activity_type?: string | null;
  country?: string | null;
  region?: string | null;
  date_from?: string | null;
  date_to?: string | null;
}

/**
 * Get all AI search profiles for the current user
 */
export async function getMyAISearchProfiles(): Promise<AISearchProfile[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to view AI search profiles.');
  }

  const profiles = await getAISearchProfiles(supabase, user.id);

  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    activity_type: profile.activity_type,
    country: profile.country,
    region: profile.region,
    date_from: profile.date_from,
    date_to: profile.date_to,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  }));
}

/**
 * Get a single AI search profile
 */
export async function getMyAISearchProfile(profileId: string): Promise<AISearchProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to view AI search profiles.');
  }

  const profile = await getAISearchProfile(supabase, profileId, user.id);
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    name: profile.name,
    activity_type: profile.activity_type,
    country: profile.country,
    region: profile.region,
    date_from: profile.date_from,
    date_to: profile.date_to,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

/**
 * Create a new AI search profile
 */
export async function createMyAISearchProfile(
  input: CreateAISearchProfileInput,
): Promise<AISearchProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to create AI search profiles.');
  }

  // TODO PR 3: the selfie is now sent live to AWS SearchFacesByImage on every
  // search and never stored. The `selfieFile` argument is silently dropped
  // here to keep the UI signature stable.
  void input.selfieFile;

  const profile = await createAISearchProfile(supabase, user.id, {
    name: input.name,
    activity_type: input.activity_type ?? null,
    country: input.country ?? null,
    region: input.region ?? null,
    date_from: input.date_from ?? null,
    date_to: input.date_to ?? null,
  });

  return {
    id: profile.id,
    name: profile.name,
    activity_type: profile.activity_type,
    country: profile.country,
    region: profile.region,
    date_from: profile.date_from,
    date_to: profile.date_to,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

/**
 * Update an AI search profile
 */
export async function updateMyAISearchProfile(
  profileId: string,
  input: UpdateAISearchProfileInput,
): Promise<AISearchProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to update AI search profiles.');
  }

  // TODO PR 3: the selfie is now sent live to AWS SearchFacesByImage on every
  // search and never stored. The `selfieFile` argument is silently dropped
  // here to keep the UI signature stable.
  void input.selfieFile;

  type UpdatePayload = Parameters<typeof updateAISearchProfile>[3];
  const updateData: UpdatePayload = {};
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

  const profile = await updateAISearchProfile(supabase, profileId, user.id, updateData);

  return {
    id: profile.id,
    name: profile.name,
    activity_type: profile.activity_type,
    country: profile.country,
    region: profile.region,
    date_from: profile.date_from,
    date_to: profile.date_to,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

/**
 * Delete an AI search profile
 */
export async function deleteMyAISearchProfile(profileId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to delete AI search profiles.');
  }

  await deleteAISearchProfile(supabase, profileId, user.id);
}

/**
 * Check if user can perform AI search (rate limiting)
 */
export async function checkAISearchAvailability(): Promise<{
  available: boolean;
  currentUsage: number;
  limit: number | null;
  description: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to check AI search availability.');
  }

  // Get user's subscription
  const subscription = await getSubscription(supabase, user.id);
  const planId: PlanId = subscription?.plan_id ?? 'free';

  // Get current usage
  const currentUsage = await getAISearchUsageCount(supabase, user.id);

  // Check rate limit
  const rateLimit = getRateLimitForPlan(planId);
  const available = !hasExceededRateLimit(planId, currentUsage);

  return {
    available,
    currentUsage,
    limit: rateLimit.maxSearchesPerMonth,
    description: rateLimit.description,
  };
}

/**
 * Run AI similarity search.
 *
 * Stubbed in PR 1 of the Rekognition rebuild. The previous CLIP/Replicate
 * implementation lives in git history before this commit. PR 3 will rewire
 * the body to AWS SearchFacesByImage + a point-lookup on `photo_faces`.
 *
 * The signature is preserved so UI imports type-check. At runtime the
 * function is unreachable because the feature flag `AI_MATCHING` is false
 * and the matching button/modal render their "coming soon" state.
 */
export async function runAISimilaritySearch(
  _selfieFile: File,
  _filters?: SimilaritySearchFilters,
  _profileId?: string,
): Promise<{
  matches: SimilarityMatch[];
  usageAfter: number;
  limit: number | null;
}> {
  // TODO PR 3: replace with AWS SearchFacesByImage + getPhotoFacesByAwsFaceIds
  // from database/queries/rekognition.ts. Increment usage via the existing
  // SECURITY DEFINER RPC after the AWS call succeeds.
  throw new Error(
    'AI matching is being rebuilt — see docs/AI_MATCHING_AUDIT.md. Wired up in PR 3.',
  );
}

/**
 * Add matched photos to "My Photos" (create talent_photo_tags)
 * This allows users to add AI-matched photos to their library
 */
export async function addMatchedPhotosToLibrary(photoIds: string[]): Promise<{ added: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to add photos to your library.');
  }

  if (photoIds.length === 0) {
    return { added: 0 };
  }

  // Tag photos for the current user (tagged by themselves via AI matching)
  const added = await tagPhotosForTalent(supabase, photoIds, user.id, user.id);

  return { added };
}

/**
 * Get user's country from profile (for prefilling filters)
 */
export async function getUserCountry(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const profile = await getProfile(supabase, user.id);
  return profile?.country_code ?? null;
}
