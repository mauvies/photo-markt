/**
 * Cart-related database queries
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface Cart {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  cart_id: string;
  photo_id: string;
  photographer_id: string;
  unit_price_cents: number;
  created_at: string;
}

export interface CartItemWithDetails extends CartItem {
  photo_url: string | null;
  photographer_name: string | null;
  /** Public profile slug for the photographer link (`slug` ?? `username`). */
  photographer_slug: string | null;
  event_name: string | null;
  event_date: string | null;
  /** Public event share code for the `/events/[shareCode]` link. */
  event_share_code: string | null;
}

/**
 * Get or create a cart for the current user
 */
export async function getOrCreateCart(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<Cart> {
  // Try to get the most recent cart for this user
  const { data: existingCart, error: fetchError } = await supabase
    .from('carts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError && fetchError.code !== 'PGRST116') {
    // PGRST116 is "not found" which is fine
    throw new Error(`Failed to fetch cart: ${getErrorMessage(fetchError)}`);
  }

  if (existingCart) {
    return existingCart as Cart;
  }

  // Create a new cart
  const { data: newCart, error: createError } = await supabase
    .from('carts')
    .insert({ user_id: userId })
    .select()
    .single();

  if (createError || !newCart) {
    throw new Error(`Failed to create cart: ${getErrorMessage(createError)}`);
  }

  return newCart as Cart;
}

/**
 * Get a cart by ID (with user check)
 */
export async function getCart(
  supabase: SupabaseServerClient,
  cartId: string,
  userId: string,
): Promise<Cart | null> {
  const { data, error } = await supabase
    .from('carts')
    .select('*')
    .eq('id', cartId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get cart: ${getErrorMessage(error)}`);
  }

  return (data as Cart) ?? null;
}

/**
 * Add a photo to a cart
 */
export async function addPhotoToCart(
  supabase: SupabaseServerClient,
  cartId: string,
  photoId: string,
  photographerId: string,
  unitPriceCents: number,
): Promise<void> {
  // Check if item already exists (idempotent)
  const { data: existing } = await supabase
    .from('cart_items')
    .select('id')
    .eq('cart_id', cartId)
    .eq('photo_id', photoId)
    .maybeSingle();

  if (existing) {
    // Already in cart, do nothing (idempotent)
    return;
  }

  const { error } = await supabase.from('cart_items').insert({
    cart_id: cartId,
    photo_id: photoId,
    photographer_id: photographerId,
    unit_price_cents: unitPriceCents,
  });

  if (error) {
    throw new Error(`Failed to add photo to cart: ${getErrorMessage(error)}`);
  }
}

/**
 * Remove a photo from a cart
 */
export async function removePhotoFromCart(
  supabase: SupabaseServerClient,
  cartId: string,
  photoId: string,
): Promise<void> {
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('cart_id', cartId)
    .eq('photo_id', photoId);

  if (error) {
    throw new Error(`Failed to remove photo from cart: ${getErrorMessage(error)}`);
  }
}

/**
 * Clear all items from a cart
 */
export async function clearCart(supabase: SupabaseServerClient, cartId: string): Promise<void> {
  const { error } = await supabase.from('cart_items').delete().eq('cart_id', cartId);

  if (error) {
    throw new Error(`Failed to clear cart: ${getErrorMessage(error)}`);
  }
}

/**
 * Get cart items with photo and event details
 */
export async function getCartItemsWithDetails(
  supabase: SupabaseServerClient,
  cartId: string,
  userId: string,
): Promise<CartItemWithDetails[]> {
  // Verify cart belongs to user
  const cart = await getCart(supabase, cartId, userId);
  if (!cart) {
    throw new Error('Cart not found or access denied');
  }

  const { data, error } = await supabase
    .from('cart_items')
    .select(
      `
      id,
      cart_id,
      photo_id,
      photographer_id,
      unit_price_cents,
      created_at,
      photos!inner(
        original_url,
        events!inner(
          name,
          date,
          share_code,
          deleted_at
        )
      )
    `,
    )
    .eq('cart_id', cartId)
    // Exclude items whose event was soft-deleted — they should never surface
    // in the cart even if the row lingers (T-040).
    .is('photos.events.deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get cart items: ${getErrorMessage(error)}`);
  }

  // Fetch photographer name + public slug separately. We key the
  // `/photographer/[slug]` link off `username`: the profile route resolves a
  // param against `slug.eq OR username.eq`, and `username` is always present
  // (unlike `slug`, which is prod-only and absent from the local schema).
  const photographerIds = [...new Set((data ?? []).map((item) => item.photographer_id))];
  const photographerProfilesMap: Record<string, { name: string | null; slug: string | null }> = {};

  if (photographerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, username')
      .in('id', photographerIds);

    if (profiles) {
      for (const profile of profiles) {
        photographerProfilesMap[profile.id] = {
          name: profile.display_name,
          slug: profile.username ?? null,
        };
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: explanation
  return (data ?? []).map((item: any) => {
    const photo = item.photos;
    const event = Array.isArray(photo?.events)
      ? photo.events.length > 0
        ? photo.events[0]
        : null
      : photo?.events;

    const photographer = photographerProfilesMap[item.photographer_id] ?? {
      name: null,
      slug: null,
    };

    return {
      id: item.id,
      cart_id: item.cart_id,
      photo_id: item.photo_id,
      photographer_id: item.photographer_id,
      unit_price_cents: item.unit_price_cents,
      created_at: item.created_at,
      photo_url: photo?.original_url ?? null,
      photographer_name: photographer.name,
      photographer_slug: photographer.slug,
      event_name: event?.name ?? null,
      event_date: event?.date ?? null,
      event_share_code: event?.share_code ?? null,
    };
  }) as CartItemWithDetails[];
}

/**
 * Get cart item count for a user
 */
export async function getCartItemCount(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<number> {
  // First get all cart IDs for this user
  const { data: carts, error: cartsError } = await supabase
    .from('carts')
    .select('id')
    .eq('user_id', userId);

  if (cartsError) {
    throw new Error(`Failed to get carts: ${getErrorMessage(cartsError)}`);
  }

  // If no carts exist, return 0
  if (!carts || carts.length === 0) {
    return 0;
  }

  const cartIds = carts.map((cart) => cart.id);

  const { count, error } = await supabase
    .from('cart_items')
    .select('id, photos!inner(events!inner(deleted_at))', { count: 'exact', head: true })
    .in('cart_id', cartIds)
    // Keep the badge consistent with the rendered cart: don't count items whose
    // event was soft-deleted (T-040).
    .is('photos.events.deleted_at', null);

  if (error) {
    throw new Error(`Failed to get cart item count: ${getErrorMessage(error)}`);
  }

  return count ?? 0;
}

/**
 * Check if a photo is already in the user's cart
 */
export async function isPhotoInCart(
  supabase: SupabaseServerClient,
  userId: string,
  photoId: string,
): Promise<boolean> {
  // First get the user's cart ID
  const { data: cart } = await supabase
    .from('carts')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cart) {
    return false;
  }

  const { data, error } = await supabase
    .from('cart_items')
    .select('id')
    .eq('cart_id', cart.id)
    .eq('photo_id', photoId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to check if photo is in cart: ${getErrorMessage(error)}`);
  }

  return data !== null;
}

// Batched version of isPhotoInCart. Use this instead of looping isPhotoInCart
// over a photo list — a 50-photo event was making 50 sequential round-trips.
export async function getPhotoIdsInCart(
  supabase: SupabaseServerClient,
  userId: string,
  photoIds: string[],
): Promise<Set<string>> {
  if (photoIds.length === 0) return new Set();

  const { data: cart } = await supabase
    .from('carts')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cart) return new Set();

  const { data, error } = await supabase
    .from('cart_items')
    .select('photo_id')
    .eq('cart_id', cart.id)
    .in('photo_id', photoIds);

  if (error) {
    throw new Error(`Failed to load cart photo ids: ${getErrorMessage(error)}`);
  }

  return new Set((data ?? []).map((row) => row.photo_id as string));
}
