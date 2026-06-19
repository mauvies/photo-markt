/**
 * Download token database queries
 * Tokens grant access to purchased photos without requiring authentication
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface DownloadToken {
  id: string;
  token: string;
  guest_order_id: string | null;
  order_id: string | null;
  claimed_by_user_id: string | null;
  expires_at: string;
  created_at: string;
}

export async function createDownloadToken(
  supabase: SupabaseServerClient,
  data: { guestOrderId?: string; orderId?: string },
): Promise<DownloadToken> {
  if (!data.guestOrderId && !data.orderId) {
    throw new Error('Either guestOrderId or orderId must be provided');
  }

  const { data: row, error } = await supabase
    .from('download_tokens')
    .insert({
      guest_order_id: data.guestOrderId ?? null,
      order_id: data.orderId ?? null,
    })
    .select()
    .single();

  if (error || !row) {
    throw new Error(`Failed to create download token: ${getErrorMessage(error)}`);
  }

  return row as DownloadToken;
}

export async function getDownloadTokenByToken(
  supabase: SupabaseServerClient,
  token: string,
): Promise<DownloadToken | null> {
  const { data, error } = await supabase
    .from('download_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get download token: ${getErrorMessage(error)}`);
  }

  return (data as DownloadToken) ?? null;
}

export async function claimDownloadToken(
  supabase: SupabaseServerClient,
  tokenId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('download_tokens')
    .update({ claimed_by_user_id: userId })
    .eq('id', tokenId);

  if (error) {
    throw new Error(`Failed to claim download token: ${getErrorMessage(error)}`);
  }
}

export async function getDownloadTokenByGuestOrderId(
  supabase: SupabaseServerClient,
  guestOrderId: string,
): Promise<DownloadToken | null> {
  const { data, error } = await supabase
    .from('download_tokens')
    .select('*')
    .eq('guest_order_id', guestOrderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get download token by guest order: ${getErrorMessage(error)}`);
  }

  return (data as DownloadToken) ?? null;
}
