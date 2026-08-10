'use server';

import { revalidatePath } from 'next/cache';
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
  getPhotoPreviewUrls,
  getPurchasablePhotoIds,
  isEventAccessible,
  isPhotoInCart,
  isPhotoTaggedForTalent,
  setCartItemAllocations,
} from '@/database/queries';
import type { CartItemWithDetails } from '@/database/queries/carts';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import type { BundleTier } from '@/lib/bundle-pricing';
import type { BundleNextTierPrompt } from '@/lib/cart-bundle-pricing';
import { discountedAllocations, priceCartWithBundles } from '@/lib/cart-bundle-pricing';
import type { CheckoutResult } from '@/lib/checkout-error';
import { PLATFORM_CURRENCY } from '@/lib/currency';
import { getBaseUrl } from '@/lib/get-base-url';
import { getSiteUrl } from '@/lib/get-site-url';
import type { GuestCartItem } from '@/lib/guest-cart';
import { buildServiceFeeLineItem } from '@/lib/stripe/service-fee-line-item';
import { buildWithdrawalConsentMetadata } from '@/lib/withdrawal-consent';

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
  /**
   * Bundle-pricing inputs (T-204), carried per item so the client can re-price
   * the cart with the SAME kernel the checkout charges from after an optimistic
   * removal — otherwise removing a photo that drops the cart below a rung would
   * leave a discounted total on screen that checkout no longer honours.
   */
  eventId: string | null;
  bundleTiers: BundleTier[] | null;
  bundleAllPhotosCents: number | null;
  bundleEligible: boolean;
}

export interface CartData {
  items: CartItemDetail[];
  /** Sum of the items' list prices — the cart's "Subtotal" row. */
  subtotalCents: number;
  /** What bundle pricing takes off that subtotal; 0 when nothing qualifies. */
  bundleDiscountCents: number;
  /** The next-rung nudge, or null when no further rung is reachable. */
  nextTier: BundleNextTierPrompt | null;
  itemCount: number;
  /** Cart items just removed because their photo is no longer purchasable (T-117). */
  removedCount: number;
}

/**
 * Map cart rows to the shape the bundle kernel prices (T-204). Shared by
 * `getCurrentCart` (display) and `createCheckoutSessionAction` (charge) so the
 * two cannot group or price the same cart differently.
 */
function toBundleCartLines(items: CartItemWithDetails[]) {
  return items.map((item) => ({
    photoId: item.photo_id,
    eventId: item.event_id,
    photographerId: item.photographer_id,
    unitPriceCents: item.unit_price_cents,
    eventName: item.event_name,
    bundleTiers: item.event_bundle_tiers,
    bundleAllPhotosCents: item.event_bundle_all_photos_cents,
    bundleEligible: item.event_supports_bundles,
  }));
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

  // Price the cart through the shared bundle kernel (T-204) — the same call
  // `createCheckoutSessionAction` makes, so the summary shown here is the
  // summary that gets charged.
  const priced = priceCartWithBundles(toBundleCartLines(items));

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
      eventId: item.event_id,
      bundleTiers: item.event_bundle_tiers,
      bundleAllPhotosCents: item.event_bundle_all_photos_cents,
      bundleEligible: item.event_supports_bundles,
    })),
    subtotalCents: priced.listSubtotalCents,
    bundleDiscountCents: priced.discountCents,
    nextTier: priced.nextTier,
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

  // Get photo details using admin client to bypass RLS. Reject soft-deleted
  // photos (T-142): a photo retained only for its buyer after being sold must
  // not be re-addable to anyone's cart.
  const { data: photo, error: photoError } = await supabaseAdmin
    .from('photos')
    .select('id, user_id, event_id')
    .eq('id', photoId)
    .is('deleted_at', null)
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

  // Invalidate the cart route's client Router Cache (T-162). This action is
  // usually called from the event view, so the cart page is NOT the current
  // route and the Server Action's automatic same-route refresh doesn't reach
  // it — without this, `experimental.staleTimes.dynamic` serves a stale
  // prefetched RSC payload of the cart on the next navigation and the just-added
  // photos don't appear until a manual F5. Same pattern the Stripe webhook uses.
  revalidatePath('/[lang]/dashboard/talent/cart', 'page');
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

  // Keep the cart route's Router Cache in sync on the next navigation (T-162).
  revalidatePath('/[lang]/dashboard/talent/cart', 'page');
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

  // Keep the cart route's Router Cache in sync on the next navigation (T-162).
  revalidatePath('/[lang]/dashboard/talent/cart', 'page');
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
export async function createCheckoutSessionAction(
  withdrawalConsentAccepted: boolean,
): Promise<CheckoutResult> {
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

  // T-228: no art. 16(m) consent, no contract. Checked right after the identity
  // gate and before any cart/DB/Stripe work — the disabled button is UX, this
  // is what actually blocks the charge.
  if (!withdrawalConsentAccepted) {
    return { ok: false, error: 'consent_required' };
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
    return { ok: false, error: 'cart_empty' };
  }

  const [purchasableIds, accessibleIds] = await Promise.all([
    getPurchasablePhotoIds(supabaseAdmin, rawPhotoIds),
    getAccessibleAuthedCartPhotoIds(supabaseAdmin, accessInfo, user.id),
  ]);
  const badPhotoIds = rawPhotoIds.filter((id) => !purchasableIds.has(id) || !accessibleIds.has(id));
  if (badPhotoIds.length > 0) {
    await deleteCartItemsByPhotoIds(supabaseAdmin, cart.id, badPhotoIds);
    return { ok: false, error: 'items_unavailable' };
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
    return { ok: false, error: 'cart_empty' };
  }

  // No Connect gate here — see the matching note in the guest checkout
  // (`src/app/[lang]/cart/actions.ts`). The money is held by the ledger and paid
  // on activation; the sale is not the place to enforce the photographer's
  // onboarding, and a mixed cart must not be blocked by one unready seller.

  const { stripe } = await import('@/lib/stripe/config');

  const siteUrl = getSiteUrl();

  // T-204: price the SERVER-validated set (`cartItems`, already filtered by the
  // purchasability + accessibility sets) through the shared bundle kernel. Never
  // a client figure — the client sends no price at all, and the ladder is read
  // from the event row, not the request.
  const priced = priceCartWithBundles(toBundleCartLines(cartItems));

  // Commit the allocation BEFORE the session exists (T-204). The webhook reads
  // it back rather than recomputing: the ladder is editable at any moment, and
  // recomputing between the charge and the delivery would produce an order that
  // disagrees with the buyer's card statement. Writing it first also means a
  // session can never exist without its allocation — the reverse order could
  // charge a discounted total and then fall back to list prices on delivery,
  // transferring money the platform never collected.
  //
  // Only DISCOUNTED groups are committed. For everything else the allocation is
  // the item's own list price, and writing that would blur what the column
  // means: null has to keep saying "no bundle applied", so an unbundled cart
  // leaves the column empty and every reader takes the pre-bundle path.
  await setCartItemAllocations(supabaseAdmin, cart.id, discountedAllocations(priced));

  // T-196: the fee rides on the POST-DISCOUNT subtotal — the buyer pays a
  // percentage of what they are actually charged. Returns null while the fee is
  // configured at 0, leaving the session identical to v1.
  const serviceFeeLineItem = buildServiceFeeLineItem(priced.subtotalCents);

  // Create Stripe Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // client_reference_id is read by the webhook to identify the cart
    client_reference_id: cart.id,
    line_items: [
      ...cartItems.map((item) => ({
        price_data: {
          currency: PLATFORM_CURRENCY,
          product_data: {
            name: item.event_name ? `Photo from ${item.event_name}` : 'Photo',
            description: item.event_name ? `Photo from ${item.event_name}` : undefined,
          },
          // The allocated share, so the line items sum to the discounted total
          // the buyer was quoted. Falls back to the list price for a photo the
          // kernel didn't allocate (it allocates every line it is given, so this
          // is a belt-and-braces default, not an expected path).
          unit_amount: priced.allocations[item.photo_id] ?? item.unit_price_cents,
        },
        quantity: 1,
      })),
      ...(serviceFeeLineItem ? [serviceFeeLineItem] : []),
    ],
    success_url: `${siteUrl}/dashboard/talent/cart?status=success`,
    cancel_url: `${siteUrl}/dashboard/talent/cart?status=cancelled`,
    metadata: {
      user_id: user.id,
      cart_id: cart.id,
      // T-228: the consent proof travels with the session so the webhook can
      // persist it on the order it creates.
      ...buildWithdrawalConsentMetadata(),
    },
  });

  if (!session.url) {
    throw new Error('No checkout URL returned');
  }

  return { ok: true, url: session.url };
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
      // Re-validate photo exists and get current price from DB. Skip
      // soft-deleted-after-sale photos (T-142) so a merge can't reintroduce one.
      const { data: photo } = await supabaseAdmin
        .from('photos')
        .select('id, user_id, event_id')
        .eq('id', item.photoId)
        .is('deleted_at', null)
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
