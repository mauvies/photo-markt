/**
 * Right-of-withdrawal consent for digital content (T-228).
 *
 * Directive 2011/83/EU art. 16(m) (Spain: art. 103.m TRLGDCU) only exempts
 * digital content from the 14-day right of withdrawal when the consumer gave
 * **prior express consent** to begin delivery AND **explicitly acknowledged**
 * that doing so loses that right. A clause in the Terms does not achieve this —
 * consumer law is mandatory and cannot be waived by contract — so the consent
 * has to be collected at checkout, per purchase, and be provable afterwards.
 *
 * This module is the single source of truth for that record. It is client-safe
 * (no server imports), like `checkout-error.ts`, so the cart clients, both
 * checkout Server Actions and the Stripe webhook share one shape.
 *
 * The buyer's browser only ever sends a **boolean**. The timestamp and the text
 * version are stamped **here, on the server** — a client-supplied timestamp is
 * worth nothing as evidence.
 */

/**
 * Version of the consent wording the buyer accepted.
 *
 * ⚠️ **Bump this whenever `cart.withdrawalConsentLabel` changes in either
 * dictionary.** In a dispute the question is not "did they tick a box" but
 * "which sentence did they tick", and the stored order row is the only place
 * that can answer it.
 */
export const WITHDRAWAL_CONSENT_VERSION = '2026-08-05';

/** Keys the consent travels under in `stripe.checkout.Session.metadata`. */
export const WITHDRAWAL_CONSENT_AT_KEY = 'wd_consent_at';
export const WITHDRAWAL_CONSENT_VERSION_KEY = 'wd_consent_version';

export interface WithdrawalConsentRecord {
  /** ISO-8601 instant the server accepted the consent-bearing checkout. */
  acceptedAt: string;
  /** Value of {@link WITHDRAWAL_CONSENT_VERSION} at that moment. */
  version: string;
}

/**
 * Stamp a fresh consent record and encode it for the Stripe session metadata.
 *
 * Piggybacking on session metadata is deliberate: it is the same mechanism the
 * guest cart already uses for `cart_<i>`/`is_guest`, so the consent reaches the
 * webhook by the same route as the order it belongs to, with no extra table and
 * no window where a session exists but its consent does not.
 */
export function buildWithdrawalConsentMetadata(now: Date = new Date()): Record<string, string> {
  return {
    [WITHDRAWAL_CONSENT_AT_KEY]: now.toISOString(),
    [WITHDRAWAL_CONSENT_VERSION_KEY]: WITHDRAWAL_CONSENT_VERSION,
  };
}

/**
 * Read the consent back out of a Stripe session's metadata.
 *
 * Fails to `null` on anything unexpected — absent keys (a session created
 * before this shipped), a non-parseable date, an empty version. Null means "no
 * consent on record", which the webhook stores as NULL columns; it must never
 * mean "assume consent".
 */
export function parseWithdrawalConsentMetadata(
  metadata: Record<string, string | null | undefined> | null | undefined,
): WithdrawalConsentRecord | null {
  if (!metadata) return null;

  const acceptedAt = metadata[WITHDRAWAL_CONSENT_AT_KEY];
  const version = metadata[WITHDRAWAL_CONSENT_VERSION_KEY];
  if (!acceptedAt || !version) return null;

  const parsed = new Date(acceptedAt);
  if (Number.isNaN(parsed.getTime())) return null;

  return { acceptedAt: parsed.toISOString(), version };
}
