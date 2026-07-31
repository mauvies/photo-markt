## Context

Photographer subscriptions are already fully webhook-driven: `createBillingCheckoutAction`
(`src/app/[lang]/dashboard/photographer/billing/actions.ts:52`) creates the Stripe session and only
inserts an `incomplete` placeholder row; the real state lands from
`customer.subscription.created/updated/deleted` in `src/app/api/stripe/webhook/route.ts:588,675`,
always via `supabaseAdmin` because `subscriptions` is RLS-enabled with **zero policies**
(`20260427162800_remote_schema.sql:418`, pinned by `test/integration/security/subscriptions-rls.test.ts`).

Cancellation is the one lifecycle transition with no path through the app. The action exists
(`actions.ts:224`) and is dead code. Three concrete gaps stand between it and a working feature, and
all three were confirmed by reading the code:

1. `subscriptions` has no `cancel_at_period_end` column (`20250217000000_create_subscriptions.sql`
   only carries `current_period_end`), so the pending state cannot be persisted or rendered.
2. `getCachedDashboardData` (`dashboard/photographer/actions.ts:153-199`) resolves the plan inside a
   `'use cache'` tagged `dashboard-photographer-<userId>` with `cacheLife('minutes')`, and **no
   subscription write path revalidates it** — neither the actions nor the webhook. A downgrade is
   therefore invisible on the dashboard until the TTL expires.
3. `cancelSubscriptionAction` throws raw strings, which Next redacts in production (the T-189
   finding), while the same file's `createBillingCheckoutAction` already returns `{ error: <code> }`.

`current_period_end` is already persisted correctly from `items.data[0].current_period_end` — Stripe's
`basil` API moved it off the subscription root (the T-159 comment at `route.ts:623-632`) — so the date
the UI needs is already in the database and no extra Stripe round-trip is required to display it.

## Goals / Non-Goals

**Goals:**

- Cancel at period end and reactivate, both driven entirely by Stripe with the database following.
- Persist and display the pending-cancellation state with the real period-end date.
- Close the cached-plan gap so a downgrade actually takes effect everywhere.
- Bring the cancel action onto the file's existing stable-error-code convention.
- Keep `subscriptions` service-role-only; add no RLS policy.

**Non-Goals:**

- Refunds or proration on cancellation — explicitly excluded.
- A Stripe billing portal. None exists today and this change does not introduce one.
- Deleting the dead `api/billing/{checkout,cancel}` routes — that is T-202. The live path is the
  Server Action; the dead route is neither revived nor used as a base.
- Fixing the pre-existing bug where several plan reads pass the **user-scoped** client and therefore
  always resolve to Free under RLS (`sales/actions.ts:31`, `events/page.tsx:148`,
  `support/page.tsx:25`). Real, but a separate ticket.
- Any change to how Free's limits are enforced. They stay write-time gates; nothing deletes data.

## Decisions

### The column is `not null default false`, additive, and written only by the webhook

`false` is the true statement about every existing row — nobody has a pending cancellation today — so
the default *is* the fact, and no reader has to handle a third `null` state. Additive with a default
also makes rollback inert: reverting the code leaves the column unread, so no down-migration exists or
is needed. Alternative considered: a nullable column with `null` meaning "unknown". Rejected — it buys
nothing and forces every call site to disambiguate `null` from `false`.

Keeping the webhook as the sole writer is not stylistic: it is what makes the local row a faithful
mirror of Stripe. If the action wrote the flag optimistically, a Stripe call that succeeded but whose
webhook was lost — or one that failed after the local write — would leave the database asserting a
cancellation Stripe does not have.

### `hasPendingCancellation` is a single exported predicate, not an inline `&&`

Placed in `src/database/queries/subscriptions.ts` next to `ACTIVE_SUBSCRIPTION_STATUSES` (already
module-private there). "Pending" means the flag is set **and** the status is still active-equivalent;
a row that is already `canceled` is finished, not pending. Written once so the billing page and any
future reader cannot drift into two different definitions — the same failure mode T-211 fixed for the
watermark rule, where four hand-written copies had diverged into two behaviours.

### The T-159 period-end rule is extracted before it gets a second copy

`subscriptionPeriodEndISO(sub)` in a new `src/lib/stripe/subscription-period.ts`. The rule ("read
`items.data[0].current_period_end`, epoch seconds → ISO, because `basil` removed the root field")
currently exists once, inline in the webhook. Both new actions need it to report the real date back to
the caller, which would make it copies #2 and #3 of a rule that has already bitten this codebase once.
Extract it, have the webhook use it too, and unit-test it.

### The webhook revalidates only `dashboard-photographer-<userId>`

`revalidateTag(tag, 'max')`, not `updateTag` — `updateTag` is for Server Actions, and this runs in a
route handler. Only that one tag is touched: `photographer-events-<userId>`, the other tag on the same
cache entry, has nothing to do with the plan, and revalidating it too would be noise that a reviewer
has to reason about. Alternative considered: reusing `revalidateOwnerListingTags`
(`src/lib/event-cache-tags.ts:46`), which hits both. Rejected — it is an *events* helper, and
stretching it into the billing path makes the billing dependency invisible from its own file.

### Cancel and reactivate return stable codes; `Unauthorized` still throws

Matching `BillingCheckoutResult` directly above them in the same file. `no_subscription`,
`already_cancelled`, `not_cancelled` and `subscription_failed` are domain outcomes the UI must
translate; an unauthenticated call is tampering, not an outcome, and stays a `throw` exactly as
`createBillingCheckoutAction` does it. Both actions return the Stripe-reported period end so the
client can state the real date in its confirmation toast without a second read.

### A plan change clears the flag rather than being blocked

One extra field on the `stripe.subscriptions.update` already present in the `updated` branch
(`actions.ts:103-116`). Choosing a paid plan is an affirmative act to keep paying, so inheriting a
cancellation from the previous plan is never what the photographer meant. The alternative — hiding or
disabling the other plans while a cancellation is pending — adds a dead state to the page, new copy,
and two clicks to express something the photographer already expressed. Confirmed with the user.

### Feedback is a direct toast, not a new `?status=` code

The `?status=` codes consumed by `BillingStatusToast`
(`settings/billing-status-toast.tsx:24`) exist for **redirect returns** — Stripe's `cancel_url` and
the `billing/resume` route. Cancel and reactivate are invoked in place from a client component, so the
matching existing pattern is the direct `sonner` toast that `upgrade-plan-button.tsx:39-59` already
uses for the in-place plan change. This satisfies the ticket's intent (reuse the existing feedback,
and do not collide with the existing `cancelled` code, which means *checkout abandoned*) without
inventing a redirect that has no other reason to exist. Deliberate, and flagged as a deviation from
the ticket's literal wording.

### The over-limit warning reads Free's limits from `PLANS`, not from constants in copy

A small pure helper `getFreePlanOverage({ storageUsedGB, eventsCount })` in `src/lib/plan-limits.ts`,
resolving the caps via `getPlanById('free')`. The billing page already has both figures from
`getDashboardData()` (`storage.usedGB`, `totals.totalEvents`), so no new query is needed. Keeping it
pure makes the boundary ("exactly at the limit is not over") unit-testable, and reading the caps from
`PLANS` means the warning cannot go stale when a plan's limits change.

### `ConfirmDialog.description` widens from `string` to `ReactNode`

So the over-limit warning is its own visually separated line instead of a run-on sentence, on a screen
about money. `string` is a `ReactNode`, so all six existing call sites are unaffected and untouched.
The warning renders as `<span className="block">`, not `<p>`, because `AlertDialogDescription` already
renders a `<p>` and nesting one is invalid HTML.

### Reactivate needs no confirmation

Cancelling is the consequential direction and gets exactly one confirmation. Reactivating restores the
status quo, costs nothing, and charges nothing — putting a dialog in front of it would be friction in
the direction of keeping the photographer paying, which is the dark pattern the requirement forbids.

## Risks / Trade-offs

- **The card lags the action until the webhook lands** (typically seconds) → The action returns the
  authoritative Stripe result, so the confirmation toast is immediate and accurate, and the client
  calls `router.refresh()`. The card itself renders strictly from the database, so it can never claim
  a cancellation Stripe does not have. Chosen over optimistic local state, which would reintroduce
  exactly the divergence the webhook-only rule exists to prevent.
- **A lost `customer.subscription.updated` webhook leaves the flag unwritten** → Stripe still cancels
  at period end and the eventual `.deleted` event still downgrades the account, so the money outcome
  is correct; only the pending *notice* is missing. Consistent with the existing failure mode for
  `plan_id`/`status`, and not made worse here. Note the handler logs DB errors and still returns 200,
  so Stripe does not retry — pre-existing behaviour, unchanged by this change.
- **The migration must be applied to production by hand** via the Supabase MCP, because `migrate.yml`
  is red on GitHub Actions billing (same as T-203/T-204) → Surfaced in the proposal, in the tasks, and
  to be repeated in the PR body. Additive and defaulted, so code and migration can land in either order.
- **A legacy row with no `current_period_end`** would render "until undefined" → Dateless copy
  variants for both the confirmation and the pending notice; the requirement pins this.
- **Revalidating on every subscription event costs a cache miss** on the photographer's dashboard →
  Negligible: subscription events are rare per user, and the alternative is serving a stale plan,
  which misreports commission rates and limits.

## Migration Plan

1. Land the additive migration `20260731000000_add_cancel_at_period_end_to_subscriptions.sql`; it is
   `if not exists` + defaulted, so it is idempotent and safe to re-run.
2. **The migration MUST reach production BEFORE the code — the order is not interchangeable.**
   `subscriptionData` includes `cancel_at_period_end`, so against a database without the column
   PostgREST rejects the **whole** update (`PGRST204`, unknown column), the handler logs it and still
   returns 200, and Stripe never retries — meaning any subscription created in that window **silently
   never activates**. Verified 2026-07-31: production does not have the column
   (`migration_registered = 0`) and has zero subscription rows, so the window is small today but real.
   Apply `20260731000000` **by hand via the Supabase MCP** before merging the code.
3. Rollback is inert: revert the code and the column simply stops being read. No down-migration.
4. Post-merge verification in Stripe test mode: cancel → webhook writes the flag → the card shows the
   real date → reactivate clears it → at period end the account is Free and the dashboard reflects it
   rather than serving a cached plan.

## Open Questions

None. The two product decisions the ticket flagged as "do not guess" — what happens to a plan change
with a pending cancellation, and whether to disclose the Free-limit consequence — were both decided
with the user before this document was written and are recorded under Decisions.
