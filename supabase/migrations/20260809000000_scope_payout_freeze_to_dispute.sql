-- T-215 (redesign): make a payout freeze traceable to the dispute that caused it.
--
-- The first design expressed "a dispute froze this payout" as `void_reason =
-- 'dispute'` alone, and restored on a won dispute by matching that reason. It does
-- not survive the normal settlement path: a chargeback opened, then refunded to
-- settle it, then closed in our favour. The refund could not re-stamp the reason
-- (it only touches `pending` rows, and the freeze had already moved the row to
-- `cancelled`), so winning restored a hold for a sale the buyer had been refunded
-- in full, and the retry cron paid it.
--
-- Scoping the freeze to a dispute id makes the two mechanisms orthogonal: a
-- dispute clears exactly the rows IT froze, and the refund accounting lives
-- entirely in `reversed_amount_cents`, which the freeze never touches.
alter table public.payouts
  add column if not exists frozen_by_dispute_id text;

comment on column public.payouts.frozen_by_dispute_id is
  'T-215: the Stripe dispute (`dp_…`) whose opening froze this payout. Closing that dispute clears only rows carrying its id — never a hold voided by a refund, which was never frozen. Freeze and refund are orthogonal: the refunded amount lives in reversed_amount_cents and is untouched by either operation.';

create index if not exists payouts_frozen_by_dispute_idx
  on public.payouts (frozen_by_dispute_id)
  where frozen_by_dispute_id is not null;

-- NOTE on `amount_cents`: it is now IMMUTABLE after insert. The reduction of a
-- partially-refunded hold moved into `reversed_amount_cents`, so the payable
-- amount is `amount_cents - reversed_amount_cents` everywhere. That keeps the
-- original amount recoverable — the retry worker's `findTransferByGroup` probe
-- matches on the EXACT amount of the transfer that was actually made — and makes
-- the reduction idempotent under Stripe redelivery, which mutating the column in
-- place was not. The existing `amount_cents > 0` check therefore becomes trivially
-- true and `reversed_amount_cents <= amount_cents` becomes the binding invariant.
