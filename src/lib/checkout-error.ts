/**
 * Typed checkout error codes (T-189).
 *
 * The cart checkout Server Actions used to `throw new Error(localizedMessage)`
 * for expected, user-facing failures (photographer not payout-ready, rate
 * limited, items no longer available, empty cart). Next.js **redacts** thrown
 * Server Action messages in production — the client only sees a generic
 * "An error occurred" — so the buyer never learned *why* checkout was blocked
 * (the reported symptom). Instead of throwing, the actions now RETURN a
 * `CheckoutResult`: an error code survives the RSC boundary intact and the
 * client maps it to localized copy (same pattern as the avatar action / T-045
 * subscription checkout).
 *
 * This module is client-safe (no server imports) so both the actions and both
 * cart client components can share the type + mapping without dragging
 * `'use server'` code into the client bundle.
 */

export type CheckoutErrorCode =
  | 'photographer_not_connected'
  | 'items_unavailable'
  | 'rate_limited'
  | 'cart_empty';

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: CheckoutErrorCode };

/**
 * Keys in the `cart` translation namespace (both cart clients are wrapped in
 * `<TranslationsProvider translations={dict.cart}>`) that a checkout error code
 * maps to. Returned as a literal union so `t(...)` typechecks against the
 * client's translation shape.
 */
export type CartCheckoutMessageKey =
  | 'checkoutPhotographerNotConnected'
  | 'itemsUnavailableRemoved'
  | 'checkoutRateLimited'
  | 'empty';

export function checkoutErrorMessageKey(code: CheckoutErrorCode): CartCheckoutMessageKey {
  switch (code) {
    case 'photographer_not_connected':
      return 'checkoutPhotographerNotConnected';
    case 'items_unavailable':
      return 'itemsUnavailableRemoved';
    case 'rate_limited':
      return 'checkoutRateLimited';
    case 'cart_empty':
      return 'empty';
  }
}
