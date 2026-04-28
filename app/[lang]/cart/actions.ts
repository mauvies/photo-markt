'use server';

import { supabaseAdmin } from '@/database/supabase-admin';
import { getBaseUrl } from '@/lib/get-base-url';
import type { GuestCartItem } from '@/lib/guest-cart';
import { stripe } from '@/lib/stripe/config';

/**
 * Create a Stripe checkout session for guest (unauthenticated) cart purchases.
 * Validates all prices server-side and encodes cart items in Stripe metadata.
 */
export async function createGuestCheckoutSessionAction(
  items: GuestCartItem[],
): Promise<{ url: string }> {
  if (items.length === 0) {
    throw new Error('Cart is empty');
  }

  // Re-validate photos and prices from DB (never trust client-side prices)
  const photoIds = items.map((i) => i.photoId);
  const { data: photos, error: photosError } = await supabaseAdmin
    .from('photos')
    .select('id, user_id, event_id, events(id, price_per_photo, name)')
    .in('id', photoIds);

  if (photosError || !photos) {
    throw new Error('Failed to validate photos');
  }

  const validatedItems = items.map((item) => {
    const photo = photos.find((p) => p.id === item.photoId);
    if (!photo) throw new Error(`Photo ${item.photoId} not found`);

    const event = Array.isArray(photo.events) ? photo.events[0] : photo.events;
    const unitPriceCents = event?.price_per_photo ? Math.round(event.price_per_photo * 100) : 0;

    return {
      photoId: item.photoId,
      photographerId: photo.user_id,
      eventName: event?.name ?? item.eventName,
      unitPriceCents,
    };
  });

  // Encode cart items in Stripe metadata (one key per item, no DB needed)
  const cartMetadata: Record<string, string> = {
    is_guest: 'true',
    cart_count: String(validatedItems.length),
  };
  for (let i = 0; i < validatedItems.length; i++) {
    cartMetadata[`cart_${i}`] = JSON.stringify({
      p: validatedItems[i].photoId,
      g: validatedItems[i].photographerId,
      c: validatedItems[i].unitPriceCents,
    });
  }

  const baseUrl = await getBaseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_creation: 'always',
    billing_address_collection: 'auto',
    line_items: validatedItems.map((item) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.eventName ? `Photo from ${item.eventName}` : 'Photo',
        },
        unit_amount: item.unitPriceCents,
      },
      quantity: 1,
    })),
    success_url: `${baseUrl}/checkout/guest/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/cart?canceled=true`,
    metadata: cartMetadata,
  });

  if (!session.url) {
    throw new Error('No checkout URL returned from Stripe');
  }

  return { url: session.url };
}
