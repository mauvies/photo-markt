/**
 * What a buyer's order status should be, given what has happened to its charge
 * (T-215).
 *
 * ## Why this is computed and not toggled
 *
 * Access control in this app is expressed entirely through `status = 'completed'`
 * — 13+ read paths gate on it (the ZIP download route, the talent library, the
 * orders page's original-vs-watermarked choice, sales, earnings, and the guest
 * download-token page). That makes a single status write the revocation, which is
 * cheap and hard to forget.
 *
 * It also makes the status the single point where a wrong transition becomes a
 * wrong entitlement. The first implementation moved it with verbs — "mark
 * disputed", "restore to completed" — and the verbs did not compose: settling a
 * chargeback by refunding the buyer (the normal path) put the order at
 * `refunded`, and then winning the dispute called "restore" and handed a fully
 * refunded buyer permanent access to the originals.
 *
 * So there is no restore. There are three facts, and a function. Every handler
 * recomputes and writes the result, which makes the outcome independent of the
 * order events arrive in and identical no matter how many times they arrive.
 */

export interface OrderClawbackFacts {
  /** The whole charge has been refunded. A PARTIAL refund is deliberately not
   *  enough — see the note below. */
  fullyRefunded: boolean;
  /** A real chargeback (not an inquiry) is open and undecided. */
  chargebackOpen: boolean;
  /** A chargeback was decided against us. */
  chargebackLost: boolean;
}

export type ClawbackOrderStatus = 'completed' | 'refunded' | 'disputed';

/**
 * ⚠️ **A partial refund does NOT revoke access** — decided deliberately.
 *
 * Stripe refunds are amounts, not line items, so a partial refund says nothing
 * about *which* photos it covers; revoking the whole order was both
 * disproportionate and arithmetically wrong. It dropped the entire sale out of
 * the photographer's `net` (`getCompletedSaleItems` filters on `completed`) while
 * only the refunded fraction came back out of `paidOut`, so
 * `withdrawable = net − paidOut − pending` silently ate the difference from that
 * photographer's OTHER, unrelated earnings — permanently.
 *
 * Keeping a partially refunded order `completed` keeps the sale in `net`, and the
 * proportional clawback removes exactly its share. The identity holds by
 * construction rather than by a comment claiming it does.
 */
export function resolveOrderStatus(facts: OrderClawbackFacts): ClawbackOrderStatus {
  // A lost chargeback is money gone AND a hostile counterparty; it outranks a
  // refund, which is at least a transaction we agreed to.
  if (facts.chargebackLost) return 'disputed';
  if (facts.fullyRefunded) return 'refunded';
  if (facts.chargebackOpen) return 'disputed';
  return 'completed';
}

/** A charge is fully refunded only when nothing is left. */
export function isFullyRefunded(
  chargeAmountCents: number | null | undefined,
  chargeAmountRefundedCents: number | null | undefined,
): boolean {
  if (typeof chargeAmountCents !== 'number' || !Number.isFinite(chargeAmountCents)) return false;
  if (chargeAmountCents <= 0) return false;
  if (
    typeof chargeAmountRefundedCents !== 'number' ||
    !Number.isFinite(chargeAmountRefundedCents)
  ) {
    return false;
  }
  return chargeAmountRefundedCents >= chargeAmountCents;
}
