/**
 * Feedback and roadmap vote queries
 */

import type { SupabaseServerClient } from './types';

export async function createFeedback(
  supabase: SupabaseServerClient,
  data: {
    user_id: string;
    role: string;
    category: string;
    rating: number | null;
    subject: string;
    description: string;
    screenshot_url?: string | null;
    page_url?: string | null;
  },
): Promise<{ id: string }> {
  const { data: row, error } = await supabase.from('feedback').insert(data).select('id').single();
  if (error) throw new Error(error.message);
  return row;
}

export async function getUserRoadmapVotes(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('roadmap_votes')
    .select('feature_key')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return data?.map((v) => v.feature_key) ?? [];
}

export async function toggleRoadmapVote(
  supabase: SupabaseServerClient,
  userId: string,
  featureKey: string,
): Promise<{ voted: boolean }> {
  const { data: existing } = await supabase
    .from('roadmap_votes')
    .select('id')
    .eq('user_id', userId)
    .eq('feature_key', featureKey)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('roadmap_votes')
      .delete()
      .eq('user_id', userId)
      .eq('feature_key', featureKey);
    if (error) throw new Error(error.message);
    return { voted: false };
  }

  const { error } = await supabase
    .from('roadmap_votes')
    .insert({ user_id: userId, feature_key: featureKey });
  if (error) throw new Error(error.message);
  return { voted: true };
}
