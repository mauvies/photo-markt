'use server';

import { getProfile } from '@/database/queries';
import {
  createPaymentAccount,
  deletePaymentAccount,
  getDefaultPaymentAccount,
  getPaymentAccounts,
  type PaymentAccount,
  type PaymentAccountType,
  setDefaultPaymentAccount,
  updatePaymentAccount,
} from '@/database/queries/payment-accounts';
import { createClient } from '@/database/server';

/**
 * Get payment accounts for current photographer
 */
export async function getPaymentAccountsAction(): Promise<PaymentAccount[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return getPaymentAccounts(supabase, user.id);
}

/**
 * Get default payment account for current photographer
 */
export async function getDefaultPaymentAccountAction(): Promise<PaymentAccount | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return getDefaultPaymentAccount(supabase, user.id);
}

/**
 * Get photographer's country from profile
 */
export async function getPhotographerCountryAction(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const profile = await getProfile(supabase, user.id);
  return profile?.country_code ?? null;
}

/**
 * Create a new payment account
 */
export async function createPaymentAccountAction(accountData: {
  type: PaymentAccountType;
  display_name: string;
  account_holder_name?: string | null;
  account_details?: Record<string, unknown>;
  is_default?: boolean;
}): Promise<PaymentAccount> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return createPaymentAccount(supabase, user.id, accountData);
}

/**
 * Update a payment account
 */
export async function updatePaymentAccountAction(
  accountId: string,
  updates: {
    display_name?: string;
    account_holder_name?: string | null;
    account_details?: Record<string, unknown>;
    is_default?: boolean;
  },
): Promise<PaymentAccount> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return updatePaymentAccount(supabase, accountId, user.id, updates);
}

/**
 * Delete a payment account
 */
export async function deletePaymentAccountAction(accountId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return deletePaymentAccount(supabase, accountId, user.id);
}

/**
 * Set a payment account as default
 */
export async function setDefaultPaymentAccountAction(accountId: string): Promise<PaymentAccount> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return setDefaultPaymentAccount(supabase, accountId, user.id);
}
