'use server';

import { headers } from 'next/headers';
import {
  getAccessiblePhotoIds,
  getPhotoPreviewUrls,
  getPurchasablePhotoIds,
} from '@/database/queries/photos';
import { getPhotographerConnectStatuses, getProfilesByIds } from '@/database/queries/profiles';
import { supabaseAdmin } from '@/database/supabase-admin';
import type { CheckoutResult } from '@/lib/checkout-error';
import { PLATFORM_CURRENCY } from '@/lib/currency';
import { getBaseUrl } from '@/lib/get-base-url';
import type { GuestCartItem } from '@/lib/guest-cart';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { stripe } from '@/lib/stripe/config';
import { buildServiceFeeLineItem } from '@/lib/stripe/service-fee-line-item';

/**
 * Ceiling on ids per guest-cart state request. A real guest cart holds a
 * handful of photos; anything past the cap is quietly left unresolved (icon
 * fallback) rather than fanned out into an unbounded service-role query +
 * bulk storage signing for an attacker-supplied list.
 */
const GUEST_CART_MAX_IDS = 100;

/**
 * Validate a guest (localStorage) cart's photo ids against the shared
 * purchasability predicate (T-117) and resolve live preview URLs for what's
 * still valid — one round trip from the client. Ids that are no longer
 * purchasable (photo hard-deleted, event soft-deleted, or `upload_status` no
 * longer approved) come back in `removedPhotoIds` so the caller can drop them
 * and show a notice; `previews` only covers the surviving ids (never the
 * snapshot `previewUrl` stashed in localStorage at add-to-cart time, which is
 * a signed original that expires after ~1h — T-115). Resolution itself is the
 * shared `getPhotoPreviewUrls` (T-130): baked thumbnail first, freshly-signed
 * original as fallback.
 *
 * This is the ONLY exported entry point for guest preview resolution
 * (T-130 hardening): the previous `resolveGuestCartPreviewsAction` was a
 * separately POSTable server action that resolved arbitrary caller-supplied
 * ids with NO purchasability filter — an unauthenticated signed-URL minting
 * surface. Folded in here so every anonymous caller passes the purchasability
 * gate, the id cap, and the IP rate limit below.
 */
export async function loadGuestCartStateAction(
  photoIds: string[],
  shareCodes: string[] = [],
  photographerIds: string[] = [],
): Promise<{
  removedPhotoIds: string[];
  previews: Record<string, string | null>;
  photographers: Record<string, { name: string | null; slug: string | null }>;
}> {
  if (photoIds.length === 0) return { removedPhotoIds: [], previews: {}, photographers: {} };

  // Unauthenticated endpoint doing service-role reads + bulk storage signing
  // — same abuse class as the guest checkout above, so same IP keying. More
  // generous than checkout (a legit guest reloads the cart page freely), and
  // on limit we degrade to "no previews resolved" WITHOUT reporting removals:
  // a rate-limited response must never make the client drop valid items.
  const rl = await rateLimit({
    key: `guest-cart-previews:${getClientIp(await headers())}`,
    limit: 60,
    windowSec: 3600,
  });
  if (!rl.ok) {
    return { removedPhotoIds: [], previews: {}, photographers: {} };
  }

  const cappedIds = photoIds.slice(0, GUEST_CART_MAX_IDS);
  // A guest item survives only if it's both purchasable (T-117: approved, event
  // alive) AND accessible (T-132: event public, or the caller presents the
  // event's share code — the guest cart stashes it per item). A private-event
  // photo with no matching code is dropped like any other unavailable item.
  const cappedPhotographerIds = [...new Set(photographerIds)].slice(0, GUEST_CART_MAX_IDS);
  const [purchasableIds, accessibleIds, photographerProfiles] = await Promise.all([
    getPurchasablePhotoIds(supabaseAdmin, cappedIds),
    getAccessiblePhotoIds(supabaseAdmin, cappedIds, shareCodes),
    getProfilesByIds(supabaseAdmin, cappedPhotographerIds),
  ]);
  const isValid = (id: string) => purchasableIds.has(id) && accessibleIds.has(id);
  const removedPhotoIds = cappedIds.filter((id) => !isValid(id));
  const validPhotoIds = cappedIds.filter(isValid);
  // baseUrl lets the pre-bake fallback of watermarked events serve the
  // fail-closed /api/watermark/ route instead of the raw original (T-131).
  const previews = await getPhotoPreviewUrls(supabaseAdmin, validPhotoIds, await getBaseUrl());

  const photographers = Object.fromEntries(
    Object.entries(photographerProfiles).map(([id, profile]) => [
      id,
      { name: profile.display_name, slug: profile.username ?? null },
    ]),
  );

  return { removedPhotoIds, previews, photographers };
}

/**
 * Create a Stripe checkout session for guest (unauthenticated) cart purchases.
 * Validates all prices server-side and encodes cart items in Stripe metadata.
 */
export async function createGuestCheckoutSessionAction(
  items: GuestCartItem[],
): Promise<CheckoutResult> {
  if (items.length === 0) {
    return { ok: false, error: 'cart_empty' };
  }

  const h = await headers();

  // Unauthenticated + hits the Stripe API (real $$$ side effect) on every
  // call, plus a DB read of all photoIds — the most serious abuse gap in the
  // limiter inventory. Keyed by IP since there's no user to key on; mirrors
  // the authed checkout's stripe-checkout:${uid} limiter (20/h) but more
  // conservative since anonymous callers carry no other identity signal.
  const ip = getClientIp(h);
  const rl = await rateLimit({ key: `guest-checkout:${ip}`, limit: 10, windowSec: 3600 });
  if (!rl.ok) {
    return { ok: false, error: 'rate_limited' };
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

  // Defense in depth (T-117): every requested photo must still be purchasable
  // (row exists, approved, event not soft-deleted) — never charge otherwise.
  // The prior select alone isn't enough: it doesn't filter `events.deleted_at`,
  // so a photo whose event was soft-deleted would otherwise sail through.
  // Access gate (T-132): a private-event item is only chargeable when the item
  // carries the event's share code — the same proof the guest presented to
  // reach the gallery. Keyed per item so a code never unlocks another event.
  const shareCodes = items
    .map((i) => i.eventShareCode)
    .filter((code): code is string => Boolean(code));
  const [purchasableIds, accessibleIds] = await Promise.all([
    getPurchasablePhotoIds(supabaseAdmin, photoIds),
    getAccessiblePhotoIds(supabaseAdmin, photoIds, shareCodes),
  ]);
  if (photoIds.some((id) => !purchasableIds.has(id) || !accessibleIds.has(id))) {
    return { ok: false, error: 'items_unavailable' };
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

  // Block checkout if any photographer has not connected their Stripe account
  const photographerIds = [...new Set(validatedItems.map((i) => i.photographerId))];
  const connectStatuses = await getPhotographerConnectStatuses(supabaseAdmin, photographerIds);
  const notConnected = connectStatuses.filter((p) => p.stripe_connect_status !== 'active');
  if (notConnected.length > 0) {
    return { ok: false, error: 'photographer_not_connected' };
  }

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

  // T-196: the service fee rides on the SERVER-validated subtotal (what
  // survived the purchasability + accessibility gates above), never on
  // anything the client sent. `buildServiceFeeLineItem` returns null while the
  // fee is configured at 0, so the session stays identical to v1.
  const subtotalCents = validatedItems.reduce((sum, item) => sum + item.unitPriceCents, 0);
  const serviceFeeLineItem = buildServiceFeeLineItem(subtotalCents);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_creation: 'always',
    billing_address_collection: 'auto',
    line_items: [
      ...validatedItems.map((item) => ({
        price_data: {
          currency: PLATFORM_CURRENCY,
          product_data: {
            name: item.eventName ? `Photo from ${item.eventName}` : 'Photo',
          },
          unit_amount: item.unitPriceCents,
        },
        quantity: 1,
      })),
      ...(serviceFeeLineItem ? [serviceFeeLineItem] : []),
    ],
    success_url: `${baseUrl}/checkout/guest/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/cart?canceled=true`,
    metadata: cartMetadata,
  });

  if (!session.url) {
    throw new Error('No checkout URL returned from Stripe');
  }

  return { ok: true, url: session.url };
}
