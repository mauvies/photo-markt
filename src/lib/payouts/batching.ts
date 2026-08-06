/**
 * Pure batching rules for the payout ledger (T-216).
 *
 * Kept free of Supabase and Stripe so the arithmetic that decides what gets
 * transferred is unit-testable without a database — the same reason
 * `bundle-pricing.ts` and `plans.ts` are pure.
 *
 * The rule that matters: **batch only what MUST be batched.** A row that on its
 * own clears Stripe's transfer minimum is paid individually, keeping
 * `source_transaction` pointed at its originating charge. That preserves two
 * things a batched transfer would lose:
 *
 *   1. **Funding.** A transfer with `source_transaction` draws on that charge's
 *      funds and cannot fail for balance reasons. A batch spans several charges,
 *      so Stripe forbids the field and the transfer draws on the platform's
 *      *available* balance instead — which is swept to the platform's bank on a
 *      schedule and holds card funds as pending for days.
 *   2. **A permanent double-pay guard.** Stripe refuses a transfer that would
 *      over-draw a charge, and unlike an idempotency key (24h) that never
 *      expires.
 *
 * Only sub-minimum leftovers aggregate, because there is no other way to ever
 * pay them: a 30-cent net can never clear a 50-cent floor alone. Their amounts,
 * and therefore the blast radius of the source-less path, are tiny by
 * construction.
 */

/**
 * Stripe's minimum transfer amount. Below this `transfers.create` rejects the
 * call outright, which is why sub-minimum nets have to accumulate rather than
 * be sent on their own.
 */
export const STRIPE_MIN_TRANSFER_CENTS = 50;

/** The subset of a payout row the batching rules actually read. */
export interface PayableRow {
  id: string;
  photographer_id: string;
  amount_cents: number;
  currency: string | null;
  stripe_charge_id: string | null;
  /**
   * Carried so the retry worker can tell whether a Stripe call was ever issued
   * under this row's idempotency key. `transfer_failed` is the only reason that
   * implies one was — the other two are decided before touching Stripe — and it
   * is what makes a recovery probe necessary once the key expires.
   */
  hold_reason: string | null;
}

/** Sub-minimum rows for one photographer in one currency, summed. */
export interface PayoutAggregate {
  photographerId: string;
  currency: string;
  rows: PayableRow[];
  totalCents: number;
}

export interface PayableSplit {
  /** Rows that clear the minimum alone — transferred individually, with `source_transaction`. */
  individual: PayableRow[];
  /** Sub-minimum groups that together clear the minimum — one source-less transfer each. */
  aggregates: PayoutAggregate[];
  /**
   * Sub-minimum groups still short of the minimum. Returned rather than dropped
   * so the caller can report them; they stay outstanding for a later run.
   */
  belowMinimum: PayoutAggregate[];
}

/**
 * Split payable rows into the individually-transferable ones and the
 * sub-minimum groups.
 *
 * Grouping is `(photographer, currency)` and never photographer alone: a
 * transfer carries exactly one currency, and a pre-T-193 order settled in USD
 * (see `createTransfer`'s docblock in `src/lib/stripe/connect.ts`). Merging the
 * two would produce a transfer Stripe rejects, or worse, one it accepts at the
 * wrong value.
 *
 * A row with no currency is skipped entirely rather than defaulted — guessing
 * the currency of money is exactly the kind of ambiguity that must fail closed.
 */
export function splitPayableRows(rows: readonly PayableRow[]): PayableSplit {
  const individual: PayableRow[] = [];
  const groups = new Map<string, PayoutAggregate>();

  for (const row of rows) {
    if (row.amount_cents <= 0) continue;
    if (!row.currency) continue;

    if (row.amount_cents >= STRIPE_MIN_TRANSFER_CENTS) {
      individual.push(row);
      continue;
    }

    const key = `${row.photographer_id}:${row.currency}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.totalCents += row.amount_cents;
    } else {
      groups.set(key, {
        photographerId: row.photographer_id,
        currency: row.currency,
        rows: [row],
        totalCents: row.amount_cents,
      });
    }
  }

  const aggregates: PayoutAggregate[] = [];
  const belowMinimum: PayoutAggregate[] = [];
  for (const group of groups.values()) {
    if (group.totalCents >= STRIPE_MIN_TRANSFER_CENTS) {
      aggregates.push(group);
    } else {
      belowMinimum.push(group);
    }
  }

  return { individual, aggregates, belowMinimum };
}

/** The Stripe idempotency key for an individually-transferred row. */
export function payoutIdempotencyKey(payoutId: string): string {
  return `payout_${payoutId}`;
}

/**
 * The `transfer_group` for an individually-transferred row.
 *
 * ⚠️ **Derived from the payout id, NOT from the order id — and both writers must
 * use it.** Stripe's idempotency layer compares the *entire request body* against
 * the one first stored under a key and rejects any divergence with a 400. So a
 * shared idempotency key is worthless unless the parameters match too.
 *
 * That is not hypothetical: the webhook originally sent `transfer_group =
 * orderId` while the retry worker sent a payout-derived group under the same
 * `payout_<id>` key. Every `transfer_failed` hold — the ONE hold reason created
 * after a Stripe call has already been made — would then 400 on every retry for
 * the key's whole 24-hour life, logged indistinguishably from a Stripe outage,
 * and once the key expired the retry would issue a genuine second transfer.
 * Exactly the stranded-then-double-paid money this ledger exists to prevent.
 *
 * Grouping by payout rather than by order loses a little grouping niceness in
 * the Stripe dashboard (`payouts.order_id` still records it) and buys back the
 * ability to find the transfer again — which is what `findTransferByGroup` needs.
 */
export function payoutTransferGroup(payoutId: string): string {
  return `payout_${payoutId}`;
}

/**
 * The Stripe idempotency key AND `transfer_group` for an aggregated batch.
 *
 * They are deliberately the same string: `transfer_group` is the only
 * server-side filter `transfers.list` offers, so it is what lets a re-drive
 * discover a transfer whose idempotency key has since expired.
 */
export function batchTransferGroup(batchId: string): string {
  return `payout_batch_${batchId}`;
}
