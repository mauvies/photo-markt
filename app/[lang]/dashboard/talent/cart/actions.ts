'use server';

import { getActiveRole } from '@/app/[lang]/actions/roles';
import {
  createPhotoUrls,
  addPhotoToCart as dbAddPhotoToCart,
  clearCart as dbClearCart,
  removePhotoFromCart as dbRemovePhotoFromCart,
  getCartItemCount,
  getCartItemsWithDetails,
  getOrCreateCart,
  isPhotoInCart,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getBaseUrl } from '@/lib/get-base-url';
import { getSiteUrl } from '@/lib/get-site-url';

export interface CartItemDetail {
  photoId: string;
  previewUrl: string | null;
  photographerId: string;
  photographerName: string | null;
  unitPriceCents: number;
  eventTitle: string | null;
  eventDate: string | null;
}

export interface CartData {
  items: CartItemDetail[];
  subtotalCents: number;
  itemCount: number;
}

/**
 * Get the current user's cart with all details
 */
export async function getCurrentCart(): Promise<CartData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to view your cart.');
  }

  // Verify user is talent
  const { activeRole } = await getActiveRole();
  if (activeRole !== 'talent') {
    throw new Error('Only talent users can access the cart.');
  }

  const cart = await getOrCreateCart(supabase, user.id);
  const items = await getCartItemsWithDetails(supabase, cart.id, user.id);

  // Generate signed URLs for preview images
  const photoPaths = items
    .map((item) => item.photo_url)
    .filter((url): url is string => url !== null);

  const previewUrlsMap: Record<string, string | null> = {};

  if (photoPaths.length > 0) {
    const baseUrl = await getBaseUrl();
    const photoUrls = await createPhotoUrls(supabase, 'photos', photoPaths, {
      expiresIn: 3600,
      useWatermark: false, // No watermark for cart previews
      baseUrl,
    });

    for (const item of photoUrls) {
      previewUrlsMap[item.path] = item.signedUrl;
    }
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.unit_price_cents, 0);

  return {
    items: items.map((item) => ({
      photoId: item.photo_id,
      previewUrl: item.photo_url ? (previewUrlsMap[item.photo_url] ?? null) : null,
      photographerId: item.photographer_id,
      photographerName: item.photographer_name,
      unitPriceCents: item.unit_price_cents,
      eventTitle: item.event_name,
      eventDate: item.event_date,
    })),
    subtotalCents,
    itemCount: items.length,
  };
}

/**
 * Add a photo to the current user's cart
 */
export async function addPhotoToCartAction(photoId: string): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to add items to your cart.');
  }

  // Verify user is talent
  const { activeRole } = await getActiveRole();

  if (activeRole !== 'talent') {
    throw new Error('Only talent users can add items to the cart.');
  }

  // Get photo details using admin client to bypass RLS
  const { data: photo, error: photoError } = await supabaseAdmin
    .from('photos')
    .select('id, user_id, event_id')
    .eq('id', photoId)
    .single();

  if (photoError || !photo) {
    throw new Error('Photo not found.');
  }

  const photographerId = photo.user_id;

  if (!photo.event_id) {
    throw new Error('Photo is not associated with an event.');
  }

  // Get event using admin client to bypass RLS
  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, price_per_photo')
    .eq('id', photo.event_id)
    .single();

  if (eventError || !event) {
    throw new Error('Event not found.');
  }

  // Allow free photos (price_per_photo can be null or 0)
  // Convert price to cents (avoid floating point issues)
  // If price is null or 0, set to 0 cents (free)
  const unitPriceCents = event.price_per_photo ? Math.round(event.price_per_photo * 100) : 0;

  // Get or create cart
  const cart = await getOrCreateCart(supabase, user.id);

  // Add photo to cart
  await dbAddPhotoToCart(supabase, cart.id, photoId, photographerId, unitPriceCents);
}

/**
 * Remove a photo from the current user's cart
 */
export async function removePhotoFromCartAction(photoId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to remove items from your cart.');
  }

  // Verify user is talent
  const { activeRole } = await getActiveRole();
  if (activeRole !== 'talent') {
    throw new Error('Only talent users can modify the cart.');
  }

  const cart = await getOrCreateCart(supabase, user.id);
  await dbRemovePhotoFromCart(supabase, cart.id, photoId);
}

/**
 * Clear the current user's cart
 */
export async function clearCartAction(): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to clear your cart.');
  }

  // Verify user is talent
  const { activeRole } = await getActiveRole();

  if (activeRole !== 'talent') {
    throw new Error('Only talent users can clear the cart.');
  }

  const cart = await getOrCreateCart(supabase, user.id);
  await dbClearCart(supabase, cart.id);
}

/**
 * Get cart item count for the current user
 */
export async function getCartItemCountAction(): Promise<number> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return 0;
  }

  // Only return count if user is talent
  try {
    const { activeRole } = await getActiveRole();

    if (activeRole !== 'talent') {
      return 0;
    }
  } catch {
    return 0;
  }

  return getCartItemCount(supabase, user.id);
}

/**
 * Check if a photo is in the current user's cart
 */
export async function checkPhotoInCartAction(photoId: string): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  // Only check if user is talent
  try {
    const { activeRole } = await getActiveRole();
    if (activeRole !== 'talent') {
      return false;
    }
  } catch {
    return false;
  }

  return isPhotoInCart(supabase, user.id, photoId);
}

/**
 * Create Stripe checkout session for cart
 */
export async function createCheckoutSessionAction(): Promise<{ url: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to checkout.');
  }

  // Verify user is talent
  const { activeRole } = await getActiveRole();
  if (activeRole !== 'talent') {
    throw new Error('Only talent users can checkout.');
  }

  // Get user's cart
  const cart = await getOrCreateCart(supabase, user.id);

  // Get cart items
  const cartItems = await getCartItemsWithDetails(supabase, cart.id, user.id);

  if (cartItems.length === 0) {
    throw new Error('Cart is empty');
  }

  const { stripe } = await import('@/lib/stripe/config');

  const siteUrl = getSiteUrl();

  // Create Stripe Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // client_reference_id is read by the webhook to identify the cart
    client_reference_id: cart.id,
    line_items: cartItems.map((item) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.event_name ? `Photo from ${item.event_name}` : 'Photo',
          description: item.event_name ? `Photo from ${item.event_name}` : undefined,
        },
        unit_amount: item.unit_price_cents,
      },
      quantity: 1,
    })),
    success_url: `${siteUrl}/dashboard/talent/cart?status=success`,
    cancel_url: `${siteUrl}/dashboard/talent/cart?status=cancelled`,
    metadata: {
      user_id: user.id,
      cart_id: cart.id,
    },
  });

  if (!session.url) {
    throw new Error('No checkout URL returned');
  }

  return { url: session.url };
}
