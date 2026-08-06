## Why

`createTransfersForOrderItems` (`src/app/api/stripe/webhook/route.ts:101-183`) is the only path that
pays photographers, and it has three exits that lose money with nothing but a log line: a Connect
account that isn't `active` after the live reconcile (`:146-151`), a net below Stripe's 50-cent transfer
minimum (`:155-160`), and a `createTransfer` that throws (`:179-181`). Each one does `console.warn` /
`console.error` and `continue`. Nothing records that the platform owes the photographer anything — the
`payouts` table has no row, no charge id, no order reference.

The consequence is silent and permanent: a photographer who sells and *then* completes Connect
onboarding never receives those sales, and no code path will ever retry. Meanwhile the Earnings tab
keeps counting that money in `withdrawableBalanceCents` (`src/database/queries/earnings.ts:154`) and
labels it "Available balance / Ready to withdraw", so the product actively promises money that cannot
arrive.

## What Changes

- Every stranded transfer becomes a **`payouts` row written before any Stripe call**, carrying amount,
  photographer, charge id, currency, order reference and a `hold_reason`
  (`connect_inactive` / `below_minimum` / `transfer_failed`).
- **The payouts row id becomes the Stripe idempotency key** (`payout_<row.id>`), shared identically by
  the webhook and the retry worker. Combined with `source_transaction` (Stripe refuses a second transfer
  once a charge's funds are drawn), this makes double-paying a sale structurally impossible rather than
  dependent on Stripe's 24-hour idempotency window.
- A new **Inngest retry worker** (cron `10,40 * * * *` plus a `payouts.retry-requested` event) pays
  outstanding holds once the photographer's Connect account is active. Rows of 50 cents or more transfer
  **individually** with their original `source_transaction`; only sub-minimum leftovers aggregate into a
  single source-less batch until they clear the minimum.
- `account.updated` emits `payouts.retry-requested` so activation pays out immediately instead of waiting
  for the cron.
- `charge.refunded` **voids outstanding holds for that charge**. Today a stranded hold is accidentally
  protected by being stranded; once a worker pays holds, one belonging to a refunded charge would be paid
  out — a loss this change would otherwise create.
- **BREAKING (data-access):** the `payouts` RLS policies `"Photographers can create their own payouts"`
  (INSERT) and `"Photographers can cancel their own pending payouts"` (UPDATE) are dropped. `pending` now
  means "a worker will really send this money", so a self-inserted row would be theft. `payouts` becomes
  photographer-read / service-role-write. Nothing breaks: `createPayout` is dead code, called only from
  `test/integration/queries/payouts.test.ts`.
- **BREAKING (schema):** `UNIQUE(stripe_transfer_id)` is dropped (one batch transfer settles several rows)
  and replaced by a partial unique on `(stripe_charge_id, photographer_id)`, which becomes the
  exactly-once key. `createPayoutFromTransfer` gains a required `stripe_charge_id` and stops swallowing
  `23505` silently — after the drop, that error means a probable double-pay, not a harmless duplicate.
- The admin payout route refuses transitions on rows that are `processing` or carry a `stripe_charge_id`,
  so an admin cannot desync a row mid-flight or cancel a hold into permanent unpayability.
- The Earnings tab's "Available Balance / Ready to withdraw" card is replaced by **Pending payout**, and
  the payout history renders each row's real status instead of a hardcoded "Paid".

## Capabilities

### New Capabilities
- `photographer-payout-ledger`: every photographer transfer that cannot be sent immediately is recorded
  as a durable, exactly-once ledger row and retried automatically until it is paid or voided.

### Modified Capabilities
<!-- None. No existing spec in openspec/specs/ states requirements about photographer transfers or the
     payouts table; `bundle-payout-allocation` covers how a discounted cart total is split across photos
     before checkout, not how the resulting money reaches the photographer. -->

## Impact

- **Schema / migration:** `public.payouts` — new columns (`stripe_charge_id`, `currency`, `hold_reason`,
  `order_id`, `order_kind`, `transfer_batch_id`), `'processing'` added to the status CHECK, the
  `stripe_transfer_id` unique constraint dropped and a partial unique added, a sweep index, and two RLS
  policies dropped. Additive and idempotent; reverting the code needs no down-migration (unread columns
  and rows are inert). Applied by the GitHub Action on merge to main, not by Vercel.
- **Payments path:** `src/app/api/stripe/webhook/route.ts` (transfer loop, `account.updated`,
  `charge.refunded`, and the header event list pinned by
  `test/unit/api/stripe-webhook-setup-doc.test.ts`), `src/lib/stripe/connect.ts` (`createTransfer` takes
  an optional `sourceTransaction`; a transfer-lookup probe is added).
- **Queries:** `src/database/queries/payouts.ts` (new ledger functions; `getTotalPendingPayouts` must
  count `'processing'` or the earnings balance reports in-flight money as withdrawable).
- **Background jobs:** new `src/lib/inngest/functions/retry-pending-payouts.ts`, registered in
  `src/app/api/inngest/route.ts`. Cron slot `10,40` is free (`0,30` storage cleanup, `15,45` reconcile).
- **Admin:** `src/app/api/admin/payouts/[id]/route.ts`.
- **UI / i18n:** `src/app/[lang]/dashboard/photographer/earnings/earnings-content.tsx` plus new strings in
  both `src/dictionaries/en.json` and `src/dictionaries/es.json`.
- **Docs:** `ARCHITECTURE.md` §4.3 (its mermaid diagram states `log + skip (recoverable via admin endpoint
  later)` and asserts there is no payout cron — both stop being true) and the `payouts` / Inngest sections
  of `CLAUDE.md`.
- **Manual step to surface at deploy:** a new Inngest function only runs in production after the app
  re-syncs with Inngest. Production has silently drifted before (5 of 13 functions registered), so the
  function must be confirmed in the Inngest dashboard after deploy.
- **Deferred to a follow-up ticket (user's decision):** an order-level sweeper for strandings this change
  does not cover — no charge id on the payment intent (`route.ts:597-601`), a guest order whose webhook
  redelivery short-circuits before the transfer block, and a photographer with no `profiles` row.
