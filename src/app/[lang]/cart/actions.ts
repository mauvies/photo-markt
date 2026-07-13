'use server';

import { headers } from 'next/headers';
import { getPurchasablePhotoIds } from '@/database/queries/photos';
import { getPhotographerConnectStatuses } from '@/database/queries/profiles';
import { createPhotoUrls } from '@/database/queries/storage';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getBaseUrl } from '@/lib/get-base-url';
import type { GuestCartItem } from '@/lib/guest-cart';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { stripe } from '@/lib/stripe/config';
import { resolvePhotoPreviewUrl } from '@/lib/thumbnails';

/**
 * Resolve the current, live preview URL for each guest cart photo — never the
 * snapshot `previewUrl` stashed in localStorage at add-to-cart time, which is
 * a signed original that expires after ~1h (T-115). Mirrors the authenticated
 * cart's resolution (`getCurrentCart`): thumbnail-first when baked (immutable,
 * never expires), falling back to a freshly-signed original — unwatermarked,
 * matching the existing "no watermark for cart previews" convention — for
 * photos whose thumbnail hasn't baked yet.
 */
export async function resolveGuestCartPreviewsAction(
  photoIds: string[],
): Promise<Record<string, string | null>> {
  if (photoIds.length === 0) return {};

  const { data: photos, error } = await supabaseAdmin
    .from('photos')
    .select('id, original_url, thumbnail_status, thumb_version')
    .in('id', photoIds);

  if (error || !photos) return {};

  const paths = photos
    .map((photo) => photo.original_url)
    .filter((url): url is string => url !== null);

  const signedUrls = await createPhotoUrls(supabaseAdmin, 'photos', paths, {
    expiresIn: 3600,
    useWatermark: false,
  });
  const signedMap: Record<string, string> = {};
  for (const item of signedUrls) {
    if (item.signedUrl) signedMap[item.path] = item.signedUrl;
  }

  const result: Record<string, string | null> = {};
  for (const photo of photos) {
    result[photo.id] = resolvePhotoPreviewUrl({
      originalUrl: photo.original_url,
      thumbnailStatus: photo.thumbnail_status,
      thumbVersion: photo.thumb_version,
      fallbackSignedUrl: photo.original_url ? (signedMap[photo.original_url] ?? null) : null,
    });
  }

  return result;
}

/**
 * Validate a guest (localStorage) cart's photo ids against the shared
 * purchasability predicate (T-117) and resolve live preview URLs for what's
 * still valid — one round trip from the client. Ids that are no longer
 * purchasable (photo hard-deleted, event soft-deleted, or `upload_status` no
 * longer approved) come back in `removedPhotoIds` so the caller can drop them
 * and show a notice; `previews` only covers the surviving ids, reusing
 * `resolveGuestCartPreviewsAction` (T-115) rather than re-deriving it.
 */
export async function loadGuestCartStateAction(
  photoIds: string[],
): Promise<{ removedPhotoIds: string[]; previews: Record<string, string | null> }> {
  if (photoIds.length === 0) return { removedPhotoIds: [], previews: {} };

  const purchasableIds = await getPurchasablePhotoIds(supabaseAdmin, photoIds);
  const removedPhotoIds = photoIds.filter((id) => !purchasableIds.has(id));
  const validPhotoIds = photoIds.filter((id) => purchasableIds.has(id));
  const previews = await resolveGuestCartPreviewsAction(validPhotoIds);

  return { removedPhotoIds, previews };
}

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

  const h = await headers();
  const referer = h.get('referer') ?? '';
  const lang = (referer.match(/\/(es|en)\//)?.[1] ?? 'en') as Locale;

  // Unauthenticated + hits the Stripe API (real $$$ side effect) on every
  // call, plus a DB read of all photoIds — the most serious abuse gap in the
  // limiter inventory. Keyed by IP since there's no user to key on; mirrors
  // the authed checkout's stripe-checkout:${uid} limiter (20/h) but more
  // conservative since anonymous callers carry no other identity signal.
  const ip = getClientIp(h);
  const rl = await rateLimit({ key: `guest-checkout:${ip}`, limit: 10, windowSec: 3600 });
  if (!rl.ok) {
    const dict = await getDictionary(lang);
    throw new Error(dict.stripeConnect.checkout.rateLimited);
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
  const purchasableIds = await getPurchasablePhotoIds(supabaseAdmin, photoIds);
  if (photoIds.some((id) => !purchasableIds.has(id))) {
    const dict = await getDictionary(lang);
    throw new Error(dict.cart.itemsUnavailableRemoved);
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
    const dict = await getDictionary(lang);
    throw new Error(dict.stripeConnect.checkout.photographerNotConnected);
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
