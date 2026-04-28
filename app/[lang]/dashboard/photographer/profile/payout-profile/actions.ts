'use server';

import { revalidatePath } from 'next/cache';
import { getProfile, updateProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';

/** Save the photographer's payout profile details and mark completion status. */
export async function updatePayoutProfileAction(updates: {
  full_name: string;
  country_code: string;
  city: string;
  address_line1: string;
  address_line2: string | null;
  state_or_region: string | null;
  postal_code: string;
  payout_method: 'bank_transfer' | 'paypal' | 'other';
  payout_details_json: Record<string, unknown>;
  is_payout_profile_complete: boolean;
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  await updateProfile(supabase, user.id, updates);
  revalidatePath('/es/dashboard/photographer/profile');
  revalidatePath('/en/dashboard/photographer/profile');
  revalidatePath('/es/dashboard/photographer/earnings');
  revalidatePath('/en/dashboard/photographer/earnings');
}

export async function getPayoutProfileStatusAction(): Promise<{
  isComplete: boolean;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const profile = await getProfile(supabase, user.id);

  return {
    isComplete: profile?.is_payout_profile_complete ?? false,
  };
}
