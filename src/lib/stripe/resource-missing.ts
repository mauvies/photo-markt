/**
 * Does this Stripe error mean "the object you referenced does not exist"?
 *
 * Our `subscriptions` row stores a `stripe_subscription_id` (and customer id)
 * that Stripe can outlive us on: a subscription deleted from the dashboard, a
 * test-mode dataset that got wiped, or a row restored from an old dump. When
 * that happens Stripe answers `resource_missing` (HTTP 404) forever — retrying
 * can never succeed.
 *
 * Treating it as a generic failure left the photographer permanently stuck:
 * they could neither change plan nor cancel, while the local row still granted
 * them a paid plan. Callers use this to tell "stale reference, recover" apart
 * from "Stripe is having a bad minute, retry".
 *
 * Deliberately structural rather than `instanceof Stripe.errors.*`: the error
 * crosses module boundaries and we only need the one stable code.
 */
export function isStripeResourceMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'resource_missing';
}
