/**
 * Guest order database queries
 * Used for unauthenticated purchases — no auth.users dependency
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export type GuestOrderStatus = 'pending' | 'completed' | 'failed' | 'canceled' | 'refunded';

export interface GuestOrder {
  id: string;
  guest_email: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  status: GuestOrderStatus;
  total_amount_cents: number;
  currency: string;
  created_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface GuestOrderItem {
  id: string;
  guest_order_id: string;
  photo_id: string;
  photographer_id: string;
  unit_price_cents: number;
  quantity: number;
  total_price_cents: number;
  created_at: string;
}

export interface GuestOrderWithItems extends GuestOrder {
  items: GuestOrderItem[];
}

export interface PendingGuestCheckoutItem {
  photoId: string;
  photographerId: string;
  eventId: string;
  eventName: string | null;
  unitPriceCents: number;
}

export async function createPendingGuestCheckout(
  supabase: SupabaseServerClient,
  cartItems: PendingGuestCheckoutItem[],
): Promise<string> {
  const { data, error } = await supabase
    .from('pending_guest_checkouts')
    .insert({ cart_items: cartItems })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create pending checkout: ${getErrorMessage(error)}`);
  }

  return data.id;
}

export async function linkPendingGuestCheckoutToSession(
  supabase: SupabaseServerClient,
  pendingCheckoutId: string,
  stripeSessionId: string,
): Promise<void> {
  const { error } = await supabase
    .from('pending_guest_checkouts')
    .update({ stripe_session_id: stripeSessionId })
    .eq('id', pendingCheckoutId);

  if (error) {
    throw new Error(`Failed to link pending checkout to session: ${getErrorMessage(error)}`);
  }
}

export async function getPendingGuestCheckout(
  supabase: SupabaseServerClient,
  pendingCheckoutId: string,
): Promise<{ id: string; cart_items: PendingGuestCheckoutItem[] } | null> {
  const { data, error } = await supabase
    .from('pending_guest_checkouts')
    .select('id, cart_items')
    .eq('id', pendingCheckoutId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get pending checkout: ${getErrorMessage(error)}`);
  }

  return data as { id: string; cart_items: PendingGuestCheckoutItem[] } | null;
}

export async function deletePendingGuestCheckout(
  supabase: SupabaseServerClient,
  pendingCheckoutId: string,
): Promise<void> {
  await supabase.from('pending_guest_checkouts').delete().eq('id', pendingCheckoutId);
}

export async function createGuestOrder(
  supabase: SupabaseServerClient,
  data: {
    guest_email: string;
    stripe_checkout_session_id: string;
    stripe_payment_intent_id?: string;
    stripe_customer_id?: string;
    total_amount_cents: number;
    currency?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<GuestOrder> {
  const { data: row, error } = await supabase
    .from('guest_orders')
    .insert({
      guest_email: data.guest_email,
      stripe_checkout_session_id: data.stripe_checkout_session_id,
      stripe_payment_intent_id: data.stripe_payment_intent_id ?? null,
      stripe_customer_id: data.stripe_customer_id ?? null,
      total_amount_cents: data.total_amount_cents,
      currency: data.currency ?? 'usd',
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: data.metadata ?? {},
    })
    .select()
    .single();

  if (error || !row) {
    throw new Error(`Failed to create guest order: ${getErrorMessage(error)}`);
  }

  return row as GuestOrder;
}

export async function addGuestOrderItems(
  supabase: SupabaseServerClient,
  guestOrderId: string,
  items: Array<{
    photo_id: string;
    photographer_id: string;
    unit_price_cents: number;
    quantity?: number;
  }>,
): Promise<GuestOrderItem[]> {
  const orderItems = items.map((item) => ({
    guest_order_id: guestOrderId,
    photo_id: item.photo_id,
    photographer_id: item.photographer_id,
    unit_price_cents: item.unit_price_cents,
    quantity: item.quantity ?? 1,
    total_price_cents: item.unit_price_cents * (item.quantity ?? 1),
  }));

  const { data, error } = await supabase.from('guest_order_items').insert(orderItems).select();

  if (error || !data) {
    throw new Error(`Failed to add guest order items: ${getErrorMessage(error)}`);
  }

  return data as GuestOrderItem[];
}

export async function getGuestOrderBySessionId(
  supabase: SupabaseServerClient,
  sessionId: string,
): Promise<GuestOrder | null> {
  const { data, error } = await supabase
    .from('guest_orders')
    .select('*')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get guest order by session: ${getErrorMessage(error)}`);
  }

  return (data as GuestOrder) ?? null;
}

export async function getGuestOrderWithItems(
  supabase: SupabaseServerClient,
  guestOrderId: string,
): Promise<GuestOrderWithItems | null> {
  const { data: order, error: orderError } = await supabase
    .from('guest_orders')
    .select('*')
    .eq('id', guestOrderId)
    .maybeSingle();

  if (orderError) {
    throw new Error(`Failed to get guest order: ${getErrorMessage(orderError)}`);
  }

  if (!order) return null;

  const { data: items, error: itemsError } = await supabase
    .from('guest_order_items')
    .select('*')
    .eq('guest_order_id', guestOrderId);

  if (itemsError) {
    throw new Error(`Failed to get guest order items: ${getErrorMessage(itemsError)}`);
  }

  return {
    ...(order as GuestOrder),
    items: (items ?? []) as GuestOrderItem[],
  };
}

export async function getGuestOrdersByEmail(
  supabase: SupabaseServerClient,
  email: string,
): Promise<GuestOrder[]> {
  const { data, error } = await supabase
    .from('guest_orders')
    .select('*')
    .eq('guest_email', email)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get guest orders by email: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as GuestOrder[];
}
