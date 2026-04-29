'use server';

import { revalidatePath } from 'next/cache';
import {
  createPaymentAccount,
  getPaymentAccounts,
  type PaymentAccountType,
} from '@/database/queries/payment-accounts';
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

  // Sync to payment_accounts so the payout modal can find the account
  if (updates.is_payout_profile_complete && updates.payout_method && updates.payout_details_json) {
    const existing = await getPaymentAccounts(supabase, user.id);
    if (existing.length === 0) {
      const accountType: PaymentAccountType =
        updates.payout_method === 'bank_transfer' ? 'bank_account' : updates.payout_method;
      const displayName =
        accountType === 'bank_account'
          ? 'Bank Account'
          : accountType === 'paypal'
            ? 'PayPal'
            : 'Payment Account';
      await createPaymentAccount(supabase, user.id, {
        type: accountType,
        display_name: displayName,
        account_holder_name: updates.full_name || null,
        account_details: updates.payout_details_json,
        is_default: true,
      });
    }
  }

  revalidatePath('/es/dashboard/photographer/profile');
  revalidatePath('/en/dashboard/photographer/profile');
  revalidatePath('/es/dashboard/photographer/earnings');
  revalidatePath('/en/dashboard/photographer/earnings');
  revalidatePath('/es/dashboard/photographer/ventas');
  revalidatePath('/en/dashboard/photographer/ventas');
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
