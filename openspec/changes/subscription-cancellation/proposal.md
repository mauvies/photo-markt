# Subscription cancellation (cancel-at-period-end + reactivate)

## Why

A photographer on Starter or Pro has **no way to cancel from the app**. There is no UI, no Stripe
billing portal (zero hits for `billingPortal` / `billing_portal` in `src/`), and
`AvailablePlansSection` filters `plan.id !== 'free'`
(`src/app/[lang]/dashboard/photographer/settings/billing/page.tsx:146`), so there is no downgrade path
either. Cancelling is the **only** exit from a paid plan and it does not exist — a photographer who
wants to stop paying has to contact support.

The server half is already written and unused: `cancelSubscriptionAction`
(`src/app/[lang]/dashboard/photographer/billing/actions.ts:224`) already calls
`stripe.subscriptions.update(id, { cancel_at_period_end: true })` and already writes nothing to
`subscriptions`. It has **zero callers**. What is missing is the ability to *persist* and *display*
the pending-cancellation state, the ability to undo it, and the UI.

## What Changes

- **Cancel = `cancel_at_period_end`, never immediate termination.** The photographer keeps their paid
  plan until the end of the period they already paid for, then drops to Free automatically. No refund,
  no immediate loss of access, no hard-delete and no local flip of the `subscriptions` row.
- **New `subscriptions.cancel_at_period_end` column** (additive, `not null default false`). Without it
  the app cannot distinguish *active* from *active-but-cancelled*, so the page cannot render the
  pending state. Written **only** by the Stripe webhook, like `plan_id`/`status` today.
- **The webhook persists the flag** on `customer.subscription.created`/`.updated`, and clears it on
  `.deleted` (a finished subscription must not read as "pending").
- **New `reactivateSubscriptionAction`** (`cancel_at_period_end: false`) so the photographer can undo
  before the period ends. Deliberately **not** called `resume`: `billing/resume/` already exists and
  means "resume the *checkout* intent after signup/login" — two different flows must not share a name.
- **`cancelSubscriptionAction` is rewritten to the file's own error convention** — it currently
  `throw`s raw strings (`'No active subscription found'`, …) which Next redacts in production (the
  T-189 finding), while `createBillingCheckoutAction` directly above returns `{ error: <stable code> }`.
- **A plan change clears a pending cancellation.** `createBillingCheckoutAction`'s in-place `updated`
  branch (`actions.ts:90-129`) would otherwise carry a ghost cancellation onto the newly chosen plan.
  Choosing a paid plan is an affirmative act to keep paying, so the flag is cleared in the same
  `stripe.subscriptions.update` call.
- **The cached plan read is invalidated on every subscription state change.**
  `getCachedDashboardData` reads the plan inside a `'use cache'`
  (`src/app/[lang]/dashboard/photographer/actions.ts:153-199`, tags `dashboard-photographer-<userId>`
  and `photographer-events-<userId>`, `cacheLife('minutes')`) and **no subscription write path
  revalidates those tags today** — not the actions, not the webhook. As things stand, when the period
  ends the dashboard keeps showing the paid plan until the TTL expires. The webhook now revalidates
  `dashboard-photographer-<userId>`.
- **UI on `/dashboard/photographer/settings/billing`**, in the current-plan card: a discreet "Cancel
  subscription" action on paid plans only (never on Free), behind **one** clear confirmation stating
  the plan, the real Stripe period-end date, and that the account then moves to Free. Once cancelled
  the card shows the pending state and offers **Reactivate**.
- **The confirmation warns about Free's limits only when the photographer already exceeds them** —
  they keep every photo, but cannot upload more (or create more events) until they are back under the
  cap. Enforcement lives only in write gates (`assertCanUploadPhoto` / `assertCanCreateEvent`,
  `src/lib/plan-limits.ts:83,108`); **nothing deletes photos on downgrade and this change adds
  nothing that does.**

Not breaking: the column is additive with a default, and rollback is inert — reverting the code leaves
the column unread, so no down-migration is needed.

## Capabilities

### New Capabilities
- `subscription-cancellation`: cancelling a paid photographer subscription at period end, undoing that
  cancellation before it takes effect, how the pending state is persisted and displayed, and the
  invariant that every plan-dependent read reflects the downgrade once it lands.

### Modified Capabilities
<!-- None. `plan-subscription-intent` already requires service-role-only subscription writes and
     webhook-only activation; this change composes with it and adds no requirement there. -->

## Impact

- **Database**: new migration `supabase/migrations/20260731000000_add_cancel_at_period_end_to_subscriptions.sql`.
  RLS unchanged — `subscriptions` stays RLS-enabled with zero policies (service-role only), the
  invariant pinned by `test/integration/security/subscriptions-rls.test.ts`.
  ⚠️ **Must be applied to production by hand via the Supabase MCP BEFORE the code merges** —
  `migrate.yml` only targets production on push to `main` and is red on GitHub Actions billing (same as
  T-203/T-204). The order is **not** interchangeable: the webhook sends `cancel_at_period_end` in its
  update payload, so against a database without the column PostgREST rejects the whole write, the
  handler logs it and still returns 200, and the subscription silently never activates.
- **Stripe**: no new API surface; `subscriptions.update` with `cancel_at_period_end` only. No refund
  logic. No new webhook event types — the existing `customer.subscription.*` handlers carry it.
- **Code**: `src/database/queries/subscriptions.ts`, `src/app/api/stripe/webhook/route.ts`,
  `src/app/[lang]/dashboard/photographer/billing/actions.ts`,
  `src/app/[lang]/dashboard/photographer/settings/billing/page.tsx`, a new client component next to it,
  new `src/lib/stripe/subscription-period.ts`, `src/lib/plan-limits.ts`,
  `src/components/confirm-dialog.tsx` (widen `description` to `ReactNode`), both dictionaries, `CLAUDE.md`.
- **Manual steps to surface**: applying the migration to prod via MCP, and an end-to-end verification
  in Stripe test mode (cancel → webhook writes the flag → card shows the real date → reactivate clears
  it → at period end the account is Free and the dashboard recalculates rather than serving a cached plan).
- **Out of scope, declared**: deleting the dead `api/billing/{checkout,cancel}` routes is T-202; refunds
  are explicitly excluded; and the pre-existing bug where several plan reads pass the **user-scoped**
  client and therefore always resolve to Free under RLS (`sales/actions.ts:31`,
  `events/page.tsx:148`, `support/page.tsx:25`) is noted for its own ticket, not fixed here.
