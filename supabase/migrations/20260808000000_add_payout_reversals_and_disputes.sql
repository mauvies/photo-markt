-- T-215 (+ T-237): make a reversed purchase reversible on BOTH sides — the
-- buyer's access and the photographer's money.
--
-- Until now the webhook handled 8 Stripe events and none of them was a dispute.
-- A lost chargeback pulled the money out of the platform account and charged a
-- ~€15 fee, while the order stayed 'completed' — so the buyer kept download
-- access indefinitely, the photographer kept the transfer, and nothing was
-- logged, alerted or recorded. `charge.refunded` was handled only halfway: the
-- order flipped to 'refunded' but a transfer already sent was never reversed
-- ("reverse manually via the Stripe Dashboard").
--
-- Two families of change, both additive:
--
--   1. `payouts` learns to record money TAKEN BACK after it was sent. T-216 made
--      the row the concurrency primitive for sending; these columns make the same
--      row the record of un-sending, so one row is the whole life of one debt.
--
--   2. `orders` / `guest_orders` gain a 'disputed' status. This is the cheap half
--      of the ticket on purpose: 13+ read paths already gate on
--      `status = 'completed'` (the ZIP route's `getPurchasedPhotoIdsForEvent`, the
--      talent library, the orders page's original-vs-watermarked choice, sales,
--      earnings, and the guest token page), so ONE new status value revokes access
--      everywhere at once and flipping back to 'completed' restores it. No reader
--      changes, therefore no reader that can be forgotten.
--
-- Rollback is inert: the columns are unread when the code is reverted and the
-- widened CHECKs accept every pre-existing value, so no down-migration. The one
-- caveat is forward-only data: rows already stamped 'disputed' or 'reversed' would
-- render as unknown statuses on a rolled-back UI.
--
-- ⚠️ APPLY BEFORE DEPLOYING THE CODE. Migrations run from the GitHub Action, not
-- Vercel. If the code ships first, the webhook writes a status the CHECK rejects,
-- every dispute 500s, and Stripe redelivers it for three days.

-- ── Reversal columns on `payouts` ───────────────────────────────────────────
alter table public.payouts
  add column if not exists reversed_amount_cents int not null default 0,
  add column if not exists stripe_reversal_id text,
  add column if not exists reversed_at timestamptz,
  add column if not exists void_reason text;

alter table public.payouts drop constraint if exists payouts_reversed_amount_check;
alter table public.payouts
  add constraint payouts_reversed_amount_check
  check (reversed_amount_cents >= 0 and reversed_amount_cents <= amount_cents);

comment on column public.payouts.reversed_amount_cents is
  'T-215: how much of this payout has been pulled back from the photographer, accumulated across successive partial refunds. Capped at amount_cents by CHECK so no sequence of partial reversals can claw back more than was ever transferred. getTotalPaidOut subtracts it, which is what keeps `withdrawable = net - paidOut - pending` true after a clawback: the sale leaves `net` when its order stops being ''completed'', so `paidOut` has to fall by the same money or the balance is understated forever.';

comment on column public.payouts.stripe_reversal_id is
  'T-215: the most recent Stripe transfer-reversal id for this row. Successive partial refunds each create their own reversal; the running total lives in reversed_amount_cents, this is the pointer for tracing the last one in the dashboard.';

comment on column public.payouts.reversed_at is
  'T-215: when money was last taken back from this payout. Set by the application, unlike paid_at (trigger-owned) — a reversal is not a status transition the trigger can see, since a partially reversed row legitimately stays ''paid''.';

comment on column public.payouts.void_reason is
  'T-215: what voided this hold — refund | dispute. Exists so a WON dispute restores exactly what opening it took away and nothing else: without it, restoring would have to match on the admin_notes prose and would silently resurrect refund-voided holds the first time that copy was reworded.';

alter table public.payouts drop constraint if exists payouts_void_reason_check;
alter table public.payouts
  add constraint payouts_void_reason_check
  check (void_reason is null or void_reason in ('refund', 'dispute'));

-- ── 'reversed' payout status ────────────────────────────────────────────────
-- A FULLY reversed row. A partially reversed one deliberately stays 'paid' with
-- a non-zero reversed_amount_cents, because the photographer did keep part of it.
--
-- NOTE the CHECK on amount_cents (> 0, from the original 2025 table) is
-- deliberately NOT relaxed: a proportional reduction that would land at or below
-- zero must VOID the hold instead of writing an amount that means nothing.
alter table public.payouts drop constraint if exists payouts_status_check;
alter table public.payouts
  add constraint payouts_status_check
  check (status in ('pending', 'approved', 'processing', 'paid', 'cancelled', 'reversed'));

-- ── 'disputed' order status ─────────────────────────────────────────────────
-- Set the moment `charge.dispute.created` arrives, not when the dispute closes:
-- a chargeback is forced unilaterally by the buyer through their bank, so it is
-- exactly the route someone would take to download and not pay. Access goes at
-- once and comes back only if the dispute is won.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'processing', 'completed', 'failed', 'canceled', 'refunded', 'disputed'));

alter table public.guest_orders drop constraint if exists guest_orders_status_check;
alter table public.guest_orders
  add constraint guest_orders_status_check
  check (status in ('pending', 'completed', 'failed', 'canceled', 'refunded', 'disputed'));
