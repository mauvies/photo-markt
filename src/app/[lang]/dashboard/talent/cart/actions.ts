'use server';

import { headers } from 'next/headers';
import { userHasRole } from '@/app/[lang]/actions/roles';
import {
  addPhotoToCart as dbAddPhotoToCart,
  clearCart as dbClearCart,
  removePhotoFromCart as dbRemovePhotoFromCart,
  deleteCartItemsByPhotoIds,
  getAccessibleAuthedCartPhotoIds,
  getCartItemAccessInfo,
  getCartItemCount,
  getCartItemsWithDetails,
  getOrCreateCart,
  getPhotographerConnectStatuses,
  getPhotoPreviewUrls,
  getPurchasablePhotoIds,
  isEventAccessible,
  isPhotoInCart,
  isPhotoTaggedForTalent,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getBaseUrl } from '@/lib/get-base-url';
import { getSiteUrl } from '@/lib/get-site-url';
import type { GuestCartItem } from '@/lib/guest-cart';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

export interface CartItemDetail {
  photoId: string;
  previewUrl: string | null;
  photographerId: string;
  photographerName: string | null;
  /** Public profile slug → `/photographer/[slug]` (null when unavailable). */
  photographerSlug: string | null;
  unitPriceCents: number;
  eventTitle: string | null;
  eventDate: string | null;
  /** Public event share code → `/events/[shareCode]` (null when unavailable). */
  eventShareCode: string | null;
}

export interface CartData {
  items: CartItemDetail[];
  subtotalCents: number;
  itemCount: number;
  /** Cart items just removed because their photo is no longer purchasable (T-117). */
  removedCount: number;
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
  if (!(await userHasRole('talent'))) {
    throw new Error('Only talent users can access the cart.');
  }

  const cart = await getOrCreateCart(supabase, user.id);

  // Self-heal: a hard-deleted photo is already gone from cart_items via the
  // `on delete cascade` FK, but two conditions are not — drop both so the
  // rendered cart and the checkout agree on what's buyable:
  //  - (T-117) a soft-deleted event or an upload_status regression
  //    (approved -> rejected) makes a photo unpurchasable; and
  //  - (T-134) an event flipped public -> private after the item was added,
  //    with no persisted matching code and no live tag, makes it inaccessible.
  const accessInfo = await getCartItemAccessInfo(supabase, cart.id);
  const rawPhotoIds = accessInfo.map((i) => i.photoId);
  const [purchasableIds, accessibleIds] = await Promise.all([
    getPurchasablePhotoIds(supabaseAdmin, rawPhotoIds),
    getAccessibleAuthedCartPhotoIds(supabaseAdmin, accessInfo, user.id),
  ]);
  const badIds = rawPhotoIds.filter((id) => !purchasableIds.has(id) || !accessibleIds.has(id));
  if (badIds.length > 0) {
    await deleteCartItemsByPhotoIds(supabaseAdmin, cart.id, badIds);
  }

  // Read details with the admin client (T-130): the joined photo/event rows
  // belong to the PHOTOGRAPHER, and `photos` RLS only exposes own rows
  // (`own_photos_select`) — with the user-scoped client the `photos!inner`
  // join silently dropped every foreign item from the buyer's cart. Ownership
  // is still enforced: `cart.id` comes from the session user's own cart and
  // `getCartItemsWithDetails` re-checks `user_id` explicitly via `getCart`.
  const items = await getCartItemsWithDetails(supabaseAdmin, cart.id, user.id);

  // Resolve previews with the shared cart resolution (T-130): baked thumbnail
  // when ready, admin-signed original as fallback. Signing MUST use
  // `supabaseAdmin` — the talent doesn't own the photo, so signing the
  // photographer's storage path with the user-scoped client can be denied by
  // RLS, which left authenticated cart previews broken while the guest cart
  // (already admin-signed) worked.
  // baseUrl lets the pre-bake fallback of watermarked events serve the
  // fail-closed /api/watermark/ route instead of the raw original (T-131).
  const previewUrlsById = await getPhotoPreviewUrls(
    supabaseAdmin,
    items.map((item) => item.photo_id),
    await getBaseUrl(),
  );

  const subtotalCents = items.reduce((sum, item) => sum + item.unit_price_cents, 0);

  return {
    items: items.map((item) => ({
      photoId: item.photo_id,
      previewUrl: previewUrlsById[item.photo_id] ?? null,
      photographerId: item.photographer_id,
      photographerName: item.photographer_name,
      photographerSlug: item.photographer_slug,
      unitPriceCents: item.unit_price_cents,
      eventTitle: item.event_name,
      eventDate: item.event_date,
      eventShareCode: item.event_share_code,
    })),
    subtotalCents,
    itemCount: items.length,
    removedCount: badIds.length,
  };
}

/**
 * Add a photo to the current user's cart.
 *
 * Access proof for private events (T-132) is one of two things: the caller
 * presents the event's own `shareCode` (the bearer token that let them reach
 * `/events/[shareCode]`), OR the authenticated user already has the photo
 * tagged in their library — a persisted relationship the server can verify
 * without the client ever echoing back a bearer token (this is the favorites
 * path). Public events need neither. Without this gate an authenticated user
 * who merely learned a private photo's UUID could add it and buy it, bypassing
 * the share-link wall entirely.
 */
export async function addPhotoToCartAction(photoId: string, shareCode?: string): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to add items to your cart.');
  }

  // Verify user is talent
  if (!(await userHasRole('talent'))) {
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

  // Get event using admin client to bypass RLS. Reject soft-deleted events so a
  // photo from an event that no longer exists can't be added (T-040).
  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, price_per_photo, is_public, share_code')
    .eq('id', photo.event_id)
    .is('deleted_at', null)
    .single();

  if (eventError || !event) {
    throw new Error('Event not found.');
  }

  // Private-event access gate (T-132): a non-public event's photo is addable
  // only with the matching share code OR when the user already has it tagged
  // (favorites — a saved photo they demonstrably had access to). The tag check
  // is a fallback, evaluated only when the code doesn't already grant access.
  // Reported as "not found" so a UUID-only probe can't distinguish "wrong id"
  // from "no access".
  const grantedByCode = isEventAccessible(event, shareCode ? [shareCode] : []);
  const accessible =
    grantedByCode || (await isPhotoTaggedForTalent(supabaseAdmin, photoId, user.id));
  if (!accessible) {
    throw new Error('Event not found.');
  }

  // Persist the access proof (T-134) so authed checkout can re-validate against
  // it later. Store the code ONLY when it's the private-event proof that
  // granted access — never for a public event (no proof needed) or the tag
  // path (the live tag is the proof). This is what lets checkout refuse a
  // photo added while public and only later flipped private.
  const accessShareCode =
    event.is_public !== true && shareCode && shareCode === event.share_code ? shareCode : null;

  // Allow free photos (price_per_photo can be null or 0)
  // Convert price to cents (avoid floating point issues)
  // If price is null or 0, set to 0 cents (free)
  const unitPriceCents = event.price_per_photo ? Math.round(event.price_per_photo * 100) : 0;

  // Get or create cart
  const cart = await getOrCreateCart(supabase, user.id);

  // Add photo to cart
  await dbAddPhotoToCart(
    supabase,
    cart.id,
    photoId,
    photographerId,
    unitPriceCents,
    accessShareCode,
  );
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
  if (!(await userHasRole('talent'))) {
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
  if (!(await userHasRole('talent'))) {
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
    if (!(await userHasRole('talent'))) {
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
    if (!(await userHasRole('talent'))) {
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
  if (!(await userHasRole('talent'))) {
    throw new Error('Only talent users can checkout.');
  }

  // Get user's cart
  const cart = await getOrCreateCart(supabase, user.id);

  // Defense in depth: re-validate BOTH purchasability (T-117) and accessibility
  // (T-134) immediately before charging, against the RAW cart_items list —
  // never charge for a photo that's since become unpurchasable (event
  // soft-deleted / upload_status regressed) OR inaccessible (event flipped
  // public -> private and the buyer holds no valid persisted code and no live
  // tag). This reaches parity with the guest checkout. `getCartItemsWithDetails`
  // below already silently excludes soft-deleted-event items, so checking
  // against its (pre-filtered) output would miss exactly that case in a mixed
  // cart and silently charge for a smaller cart than the user saw. Self-heal by
  // deleting the bad rows so the next cart load is already clean.
  const accessInfo = await getCartItemAccessInfo(supabase, cart.id);
  const rawPhotoIds = accessInfo.map((i) => i.photoId);
  if (rawPhotoIds.length === 0) {
    throw new Error('Cart is empty');
  }

  const [purchasableIds, accessibleIds] = await Promise.all([
    getPurchasablePhotoIds(supabaseAdmin, rawPhotoIds),
    getAccessibleAuthedCartPhotoIds(supabaseAdmin, accessInfo, user.id),
  ]);
  const badPhotoIds = rawPhotoIds.filter((id) => !purchasableIds.has(id) || !accessibleIds.has(id));
  if (badPhotoIds.length > 0) {
    await deleteCartItemsByPhotoIds(supabaseAdmin, cart.id, badPhotoIds);
    const h = await headers();
    const referer = h.get('referer') ?? '';
    const lang = (referer.match(/\/(es|en)\//)?.[1] ?? 'en') as Locale;
    const dict = await getDictionary(lang);
    throw new Error(dict.cart.itemsUnavailableRemoved);
  }

  // Get cart items — admin client for the same reason as `getCurrentCart`
  // (T-130): `photos` RLS hides the photographer's rows from the buyer, so a
  // user-scoped read would see an empty cart and wrongly reject checkout.
  const allCartItems = await getCartItemsWithDetails(supabaseAdmin, cart.id, user.id);

  // Charge ONLY rows that passed both checks above. The admin read re-queries
  // cart_items, so a row inserted concurrently between the raw-id snapshot and
  // this read has never been validated — filtering by the validated sets closes
  // that window instead of trusting the fresh list.
  const cartItems = allCartItems.filter(
    (item) => purchasableIds.has(item.photo_id) && accessibleIds.has(item.photo_id),
  );

  if (cartItems.length === 0) {
    throw new Error('Cart is empty');
  }

  // Block checkout if any photographer has not connected their Stripe account
  const photographerIds = [...new Set(cartItems.map((i) => i.photographer_id))];
  const connectStatuses = await getPhotographerConnectStatuses(supabaseAdmin, photographerIds);
  const notConnected = connectStatuses.filter((p) => p.stripe_connect_status !== 'active');
  if (notConnected.length > 0) {
    const h = await headers();
    const referer = h.get('referer') ?? '';
    const lang = (referer.match(/\/(es|en)\//)?.[1] ?? 'en') as Locale;
    const dict = await getDictionary(lang);
    throw new Error(dict.stripeConnect.checkout.photographerNotConnected);
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

/**
 * Merge guest cart items into the authenticated user's DB cart.
 * Returns the number of items successfully added (duplicates skipped silently).
 * No role check — merge runs immediately after sign-in before role is confirmed.
 */
export async function mergeGuestCartAction(items: GuestCartItem[]): Promise<number> {
  if (items.length === 0) return 0;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return 0;

  const cart = await getOrCreateCart(supabase, user.id);
  let merged = 0;

  // Union of every code the guest cart carries (T-132) — the same set the guest
  // preview and guest checkout use. A code still only unlocks its OWN event, but
  // pooling them keeps merge consistent with those paths: an item whose event
  // another item already proved (same private event, code stashed on a sibling
  // item) isn't silently dropped on login just because its own snapshot lacked
  // the code.
  const shareCodes = items
    .map((i) => i.eventShareCode)
    .filter((code): code is string => Boolean(code));

  for (const item of items) {
    try {
      // Re-validate photo exists and get current price from DB
      const { data: photo } = await supabaseAdmin
        .from('photos')
        .select('id, user_id, event_id')
        .eq('id', item.photoId)
        .maybeSingle();

      if (!photo) continue;

      const { data: event } = await supabaseAdmin
        .from('events')
        .select('id, price_per_photo, is_public, share_code')
        .eq('id', photo.event_id)
        .is('deleted_at', null)
        .maybeSingle();

      // Skip photos whose event was soft-deleted — never merge them in (T-040).
      if (!event) continue;

      // Private-event access gate (T-132): merge is the bridge into the authed
      // cart (which authed checkout trusts), so a private item with no matching
      // code in the cart must never cross it.
      if (!isEventAccessible(event, shareCodes)) continue;

      // Persist the access proof (T-134): for a private event the cart proved,
      // store its own share code (a code only unlocks its own event, so a
      // pooled match means this event's code IS present). Public events store
      // null. This is what authed checkout re-validates against.
      const accessShareCode =
        event.is_public !== true && event.share_code && shareCodes.includes(event.share_code)
          ? event.share_code
          : null;

      const unitPriceCents = event.price_per_photo ? Math.round(event.price_per_photo * 100) : 0;

      await dbAddPhotoToCart(
        supabase,
        cart.id,
        item.photoId,
        photo.user_id,
        unitPriceCents,
        accessShareCode,
      );
      merged++;
    } catch {
      // skip individual failures — best-effort merge
    }
  }

  return merged;
}
