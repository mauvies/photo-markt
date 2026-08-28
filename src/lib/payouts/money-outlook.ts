/**
 * "How much is coming to me, and when?" — the only two things a photographer
 * asks about their money (T-247).
 *
 * ## Why this collapses four numbers into one
 *
 * The Payouts tab grew four figures: money our ledger had not sent, money Stripe
 * held, money available, and money heading to the bank. Four balances is three
 * too many, and two of them were not balances at all:
 *
 *   - **Not sent yet** is €0 in every healthy account. It is not a stage the
 *     money passes through, it is an EXCEPTION — Connect unfinished, a net below
 *     Stripe's floor, a transfer that threw — and an exception needs an action,
 *     not a stat card. It belongs in a warning that appears only when it is real.
 *   - **In your bank** is not observable. Once money leaves Stripe we cannot see
 *     it, so there is no total to show; there is only the NEXT payout, which is
 *     an event with a date rather than a balance.
 *
 * What is left is genuinely one thing: money that is already the photographer's
 * and is not yet in their bank. Stripe splits it into `pending` and `available`
 * for its own settlement reasons; the photographer experiences one pot with one
 * date on it, and the date is what carries the meaning.
 *
 * ## Every date here came from Stripe
 *
 * Nothing is derived from `delay_days` — the two disagree in practice (an account
 * on 7 saw `available_on` land three days out), so a computed date would read as
 * authoritative and be wrong. When Stripe gives no date, `timing` is `unknown`
 * and the UI says nothing about when.
 */

export interface PayoutOutlookInput {
  availableCents: number;
  pendingCents: number;
  nextAvailableOn: string | null;
  nextPayout: { amountCents: number; arrivalDate: string; status: string } | null;
}

export type MoneyTiming =
  /** Stripe is sending it to the bank; this is the arrival date it gave us. */
  | { kind: 'arriving'; date: string }
  /** Still settling; this is when Stripe says it becomes available. */
  | { kind: 'available-on'; date: string }
  /** Available now, with no payout scheduled yet. */
  | { kind: 'ready' }
  /** Stripe told us nothing. Say nothing. */
  | { kind: 'unknown' };

export interface MoneyOnItsWay {
  totalCents: number;
  timing: MoneyTiming;
}

/**
 * The one figure and the one date, or `null` when there is no money in flight at
 * all — which the UI renders as an empty state rather than a €0.00 card, because
 * "€0.00 arriving on no date" is noise, not information.
 */
export function resolveMoneyOnItsWay(outlook: PayoutOutlookInput | null): MoneyOnItsWay | null {
  if (!outlook) return null;

  const totalCents = Math.max(0, outlook.availableCents) + Math.max(0, outlook.pendingCents);
  if (totalCents <= 0) return null;

  return { totalCents, timing: resolveTiming(outlook) };
}

/**
 * Most-committed answer first: a scheduled payout beats a settlement estimate,
 * because it names the day the money reaches the bank rather than the day it
 * merely stops being held.
 */
function resolveTiming(outlook: PayoutOutlookInput): MoneyTiming {
  if (outlook.nextPayout) return { kind: 'arriving', date: outlook.nextPayout.arrivalDate };
  if (outlook.nextAvailableOn) return { kind: 'available-on', date: outlook.nextAvailableOn };
  if (outlook.availableCents > 0) return { kind: 'ready' };
  return { kind: 'unknown' };
}
