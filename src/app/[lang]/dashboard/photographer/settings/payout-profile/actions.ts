'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getProfile,
  getProfileStripeConnect,
  updateProfile,
  updateProfileStripeConnect,
} from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import { env } from '@/env.mjs';
import { createAccountLink, createExpressAccount } from '@/lib/stripe/connect';

/** Save the photographer's payout profile details and mark completion status. */
export async function updatePayoutProfileAction(updates: {
  full_name: string;
  country_code: string;
  city: string;
  address_line1: string;
  address_line2: string | null;
  state_or_region: string | null;
  postal_code: string;
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

  revalidatePath('/es/dashboard/photographer/settings');
  revalidatePath('/en/dashboard/photographer/settings');
  revalidatePath('/es/dashboard/photographer/earnings');
  revalidatePath('/en/dashboard/photographer/earnings');
  revalidatePath('/es/dashboard/photographer/ventas');
  revalidatePath('/en/dashboard/photographer/ventas');
  revalidatePath('/es/dashboard/photographer/ganancias');
  revalidatePath('/en/dashboard/photographer/ganancias');
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

/** Get the photographer's current Stripe Connect status. */
export async function getStripeConnectStatusAction(): Promise<{
  stripe_connect_status: 'not_connected' | 'pending' | 'active' | 'restricted';
  stripe_connect_account_id: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Unauthorized');

  const connect = await getProfileStripeConnect(supabase, user.id);
  return {
    stripe_connect_status: connect?.stripe_connect_status ?? 'not_connected',
    stripe_connect_account_id: connect?.stripe_connect_account_id ?? null,
  };
}

/**
 * Create or resume Stripe Connect Express onboarding.
 * Creates the account if it doesn't exist yet, then redirects to Stripe's hosted onboarding.
 */
export async function connectStripeAccountAction(lang: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Unauthorized');

  const [connect, profile] = await Promise.all([
    getProfileStripeConnect(supabase, user.id),
    getProfile(supabase, user.id),
  ]);

  let accountId = connect?.stripe_connect_account_id ?? null;

  if (!accountId) {
    const { data: authUser } = await supabase.auth.getUser();
    const email = authUser.user?.email ?? '';
    const country = profile?.country_code ?? 'US';

    accountId = await createExpressAccount({ email, country });
    await updateProfileStripeConnect(supabase, user.id, {
      stripe_connect_account_id: accountId,
      stripe_connect_status: 'pending',
    });
  }

  const base = env.SITE_URL;
  const returnUrl = `${base}/${lang}/dashboard/photographer/settings/payout-profile?connect=success`;
  const refreshUrl = `${base}/${lang}/dashboard/photographer/settings/payout-profile?connect=refresh`;

  const onboardingUrl = await createAccountLink({
    accountId,
    returnUrl,
    refreshUrl,
  });

  redirect(onboardingUrl);
}

/**
 * Regenerate an expired Stripe Connect onboarding link and redirect.
 * Used when the photographer returns via the refresh_url.
 */
export async function refreshStripeAccountLinkAction(lang: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Unauthorized');

  const connect = await getProfileStripeConnect(supabase, user.id);
  const accountId = connect?.stripe_connect_account_id;

  if (!accountId) throw new Error('No Stripe Connect account found');

  const base = env.SITE_URL;
  const returnUrl = `${base}/${lang}/dashboard/photographer/settings/payout-profile?connect=success`;
  const refreshUrl = `${base}/${lang}/dashboard/photographer/settings/payout-profile?connect=refresh`;

  const onboardingUrl = await createAccountLink({ accountId, returnUrl, refreshUrl });
  redirect(onboardingUrl);
}
