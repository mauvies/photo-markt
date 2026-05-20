/**
 * Orders-related database queries
 * For tracking completed purchases integrated with Stripe
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'refunded';

export interface Order {
  id: string;
  user_id: string;
  cart_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  status: OrderStatus;
  total_amount_cents: number;
  currency: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface OrderItem {
  id: string;
  order_id: string;
  photo_id: string;
  photographer_id: string;
  unit_price_cents: number;
  quantity: number;
  total_price_cents: number;
  created_at: string;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

/**
 * Create a new order
 */
export async function createOrder(
  supabase: SupabaseServerClient,
  userId: string,
  orderData: {
    cart_id?: string;
    stripe_payment_intent_id?: string;
    stripe_customer_id?: string;
    stripe_checkout_session_id?: string;
    status?: OrderStatus;
    total_amount_cents: number;
    currency?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .insert({
      user_id: userId,
      cart_id: orderData.cart_id ?? null,
      stripe_payment_intent_id: orderData.stripe_payment_intent_id ?? null,
      stripe_customer_id: orderData.stripe_customer_id ?? null,
      stripe_checkout_session_id: orderData.stripe_checkout_session_id ?? null,
      status: orderData.status ?? 'pending',
      total_amount_cents: orderData.total_amount_cents,
      currency: orderData.currency ?? 'usd',
      metadata: orderData.metadata ?? {},
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create order: ${getErrorMessage(error)}`);
  }

  return data as Order;
}

/**
 * Add items to an order
 */
export async function addOrderItems(
  supabase: SupabaseServerClient,
  orderId: string,
  items: Array<{
    photo_id: string;
    photographer_id: string;
    unit_price_cents: number;
    quantity?: number;
  }>,
): Promise<OrderItem[]> {
  const orderItems = items.map((item) => ({
    order_id: orderId,
    photo_id: item.photo_id,
    photographer_id: item.photographer_id,
    unit_price_cents: item.unit_price_cents,
    quantity: item.quantity ?? 1,
    total_price_cents: item.unit_price_cents * (item.quantity ?? 1),
  }));

  const { data, error } = await supabase.from('order_items').insert(orderItems).select();

  if (error || !data) {
    throw new Error(`Failed to add order items: ${getErrorMessage(error)}`);
  }

  return data as OrderItem[];
}

/**
 * Get order by ID
 */
export async function getOrder(
  supabase: SupabaseServerClient,
  orderId: string,
  userId: string,
): Promise<OrderWithItems | null> {
  // First get the order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    if (orderError?.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get order: ${getErrorMessage(orderError)}`);
  }

  // Verify user has access (either buyer or photographer)
  if (order.user_id !== userId) {
    // Check if user is a photographer for any items in this order
    const { data: items } = await supabase
      .from('order_items')
      .select('photographer_id')
      .eq('order_id', orderId)
      .eq('photographer_id', userId)
      .limit(1);

    if (!items || items.length === 0) {
      throw new Error('Access denied: Order not found or access denied');
    }
  }

  // Get order items
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  if (itemsError) {
    throw new Error(`Failed to get order items: ${getErrorMessage(itemsError)}`);
  }

  return {
    ...(order as Order),
    items: (items ?? []) as OrderItem[],
  };
}

/**
 * Get order by Stripe PaymentIntent ID
 */
export async function getOrderByPaymentIntentId(
  supabase: SupabaseServerClient,
  paymentIntentId: string,
): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get order by payment intent: ${getErrorMessage(error)}`);
  }

  return data as Order;
}

/**
 * Get order by Stripe Checkout Session ID
 */
export async function getOrderByCheckoutSessionId(
  supabase: SupabaseServerClient,
  checkoutSessionId: string,
): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('stripe_checkout_session_id', checkoutSessionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get order by checkout session: ${getErrorMessage(error)}`);
  }

  return data as Order;
}

/**
 * Update order status
 */
export async function updateOrderStatus(
  supabase: SupabaseServerClient,
  orderId: string,
  status: OrderStatus,
  metadata?: Record<string, unknown>,
): Promise<Order> {
  const updateData: Partial<Order> = { status };
  if (metadata) {
    // Merge with existing metadata
    const { data: existing } = await supabase
      .from('orders')
      .select('metadata')
      .eq('id', orderId)
      .single();

    updateData.metadata = {
      ...((existing?.metadata as Record<string, unknown>) ?? {}),
      ...metadata,
    };
  }

  const { data, error } = await supabase
    .from('orders')
    .update(updateData)
    .eq('id', orderId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update order status: ${getErrorMessage(error)}`);
  }

  return data as Order;
}

/**
 * Get orders for a user (buyer)
 */
export async function getUserOrders(
  supabase: SupabaseServerClient,
  userId: string,
  limit = 50,
): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to get user orders: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as Order[];
}

/**
 * Get orders for a photographer (sales)
 */
export async function getPhotographerOrders(
  supabase: SupabaseServerClient,
  photographerId: string,
  startDate?: string,
  endDate?: string,
  limit = 50,
): Promise<Order[]> {
  let query = supabase
    .from('orders')
    .select('*, order_items!inner(photographer_id)')
    .eq('order_items.photographer_id', photographerId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (startDate) {
    query = query.gte('created_at', startDate);
  }
  if (endDate) {
    query = query.lte('created_at', endDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get photographer orders: ${getErrorMessage(error)}`);
  }

  // Filter out duplicate orders (since we're joining with order_items)
  const uniqueOrders = new Map<string, Order>();
  (data ?? []).forEach((order: Order & { order_items?: unknown }) => {
    if (!uniqueOrders.has(order.id)) {
      uniqueOrders.set(order.id, order);
    }
  });

  return Array.from(uniqueOrders.values());
}

/**
 * Photo IDs the given user has purchased within a specific event. Backs the
 * bulk-download permission check (paid events) and the talent/public viewer's
 * skipped-count UX. Returns an empty set on any error (fail-closed).
 */
export async function getPurchasedPhotoIdsForEvent(
  supabase: SupabaseServerClient,
  userId: string,
  eventId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('order_items')
    .select('photo_id, orders!inner(user_id, status), photos!inner(event_id)')
    .eq('orders.user_id', userId)
    .eq('orders.status', 'completed')
    .eq('photos.event_id', eventId);

  if (error || !data) return new Set<string>();
  return new Set((data as Array<{ photo_id: string }>).map((row) => row.photo_id));
}
