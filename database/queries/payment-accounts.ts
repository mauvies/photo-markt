/**
 * Payment account-related database queries
 * For managing photographer payment methods (bank accounts, PayPal, etc.)
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export type PaymentAccountType = 'bank_account' | 'paypal' | 'wise' | 'other';

export interface PaymentAccount {
  id: string;
  photographer_id: string;
  type: PaymentAccountType;
  account_holder_name: string | null;
  account_details: Record<string, unknown>;
  display_name: string;
  is_default: boolean;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Get payment accounts for a photographer
 */
export async function getPaymentAccounts(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<PaymentAccount[]> {
  const { data, error } = await supabase
    .from('payment_accounts')
    .select('*')
    .eq('photographer_id', photographerId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get payment accounts: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as PaymentAccount[];
}

/**
 * Get a single payment account by ID
 */
export async function getPaymentAccount(
  supabase: SupabaseServerClient,
  accountId: string,
  photographerId: string,
): Promise<PaymentAccount | null> {
  const { data, error } = await supabase
    .from('payment_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('photographer_id', photographerId)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get payment account: ${getErrorMessage(error)}`);
  }

  return data as PaymentAccount | null;
}

/**
 * Get default payment account for a photographer
 */
export async function getDefaultPaymentAccount(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<PaymentAccount | null> {
  const { data, error } = await supabase
    .from('payment_accounts')
    .select('*')
    .eq('photographer_id', photographerId)
    .eq('is_default', true)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get default payment account: ${getErrorMessage(error)}`);
  }

  return data as PaymentAccount | null;
}

/**
 * Create a new payment account
 */
export async function createPaymentAccount(
  supabase: SupabaseServerClient,
  photographerId: string,
  accountData: {
    type: PaymentAccountType;
    display_name: string;
    account_holder_name?: string | null;
    account_details?: Record<string, unknown>;
    is_default?: boolean;
  },
): Promise<PaymentAccount> {
  // If this is set as default, unset other defaults first
  if (accountData.is_default) {
    await supabase
      .from('payment_accounts')
      .update({ is_default: false })
      .eq('photographer_id', photographerId)
      .eq('is_default', true);
  }

  const { data, error } = await supabase
    .from('payment_accounts')
    .insert({
      photographer_id: photographerId,
      type: accountData.type,
      display_name: accountData.display_name,
      account_holder_name: accountData.account_holder_name ?? null,
      account_details: accountData.account_details ?? {},
      is_default: accountData.is_default ?? false,
      is_verified: false,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create payment account: ${getErrorMessage(error)}`);
  }

  return data as PaymentAccount;
}

/**
 * Update a payment account
 */
export async function updatePaymentAccount(
  supabase: SupabaseServerClient,
  accountId: string,
  photographerId: string,
  updates: {
    display_name?: string;
    account_holder_name?: string | null;
    account_details?: Record<string, unknown>;
    is_default?: boolean;
  },
): Promise<PaymentAccount> {
  // If setting as default, unset other defaults first
  if (updates.is_default) {
    await supabase
      .from('payment_accounts')
      .update({ is_default: false })
      .eq('photographer_id', photographerId)
      .eq('is_default', true)
      .neq('id', accountId);
  }

  const { data, error } = await supabase
    .from('payment_accounts')
    .update(updates)
    .eq('id', accountId)
    .eq('photographer_id', photographerId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update payment account: ${getErrorMessage(error)}`);
  }

  return data as PaymentAccount;
}

/**
 * Delete a payment account
 */
export async function deletePaymentAccount(
  supabase: SupabaseServerClient,
  accountId: string,
  photographerId: string,
): Promise<void> {
  const { error } = await supabase
    .from('payment_accounts')
    .delete()
    .eq('id', accountId)
    .eq('photographer_id', photographerId);

  if (error) {
    throw new Error(`Failed to delete payment account: ${getErrorMessage(error)}`);
  }
}

/**
 * Set a payment account as default
 */
export async function setDefaultPaymentAccount(
  supabase: SupabaseServerClient,
  accountId: string,
  photographerId: string,
): Promise<PaymentAccount> {
  // Unset all other defaults
  await supabase
    .from('payment_accounts')
    .update({ is_default: false })
    .eq('photographer_id', photographerId)
    .eq('is_default', true)
    .neq('id', accountId);

  // Set this one as default
  const { data, error } = await supabase
    .from('payment_accounts')
    .update({ is_default: true })
    .eq('id', accountId)
    .eq('photographer_id', photographerId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to set default payment account: ${getErrorMessage(error)}`);
  }

  return data as PaymentAccount;
}
