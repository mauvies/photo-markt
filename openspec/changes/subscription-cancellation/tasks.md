## 1. Persistence

- [x] 1.1 Add migration `supabase/migrations/20260731000000_add_cancel_at_period_end_to_subscriptions.sql`: `alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false`, plus a `comment on column` stating the Stripe webhook is its only writer. No RLS change.
- [x] 1.2 Add `cancel_at_period_end: boolean` to the `Subscription` interface in `src/database/queries/subscriptions.ts`.
- [x] 1.3 Export `hasPendingCancellation(sub)` from the same file: flag set **and** status still active-equivalent (reuse the module's `ACTIVE_SUBSCRIPTION_STATUSES`).
- [x] 1.4 Run `pnpm db:reset` so the local stack has the column before writing integration tests.

## 2. Shared helpers

- [x] 2.1 Create `src/lib/stripe/subscription-period.ts` with `subscriptionPeriodEndISO(sub)` reading `items.data[0].current_period_end` (epoch seconds → ISO, `null` when absent or non-numeric), carrying the T-159 rationale as a comment.
- [x] 2.2 Replace the inline extraction in the webhook's `created/updated` branch with a call to that helper — one rule, one place.
- [x] 2.3 Add `getFreePlanOverage({ storageUsedGB, eventsCount })` to `src/lib/plan-limits.ts`, resolving Free's caps via `getPlanById('free')`; exactly at a limit is **not** over.

## 3. Webhook (the only writer of subscription state)

- [x] 3.1 Add `cancel_at_period_end: subscription.cancel_at_period_end ?? false` to `subscriptionData` in the `customer.subscription.created/updated` handler.
- [x] 3.2 In `customer.subscription.deleted`, write `cancel_at_period_end: false` alongside `status: 'canceled'`.
- [x] 3.3 Import `revalidateTag` from `next/cache` and, after each successful subscription write in all three branches, call `revalidateTag(\`dashboard-photographer-${supabaseUserId}\`, 'max')` with a comment naming `getCachedDashboardData` as the cached plan read it invalidates.

## 4. Server Actions

- [x] 4.1 Add the `SubscriptionActionError` / `SubscriptionActionResult` types to `billing/actions.ts`, mirroring the existing `BillingCheckoutResult` convention.
- [x] 4.2 Rewrite `cancelSubscriptionAction` to return those types: service-role read, `no_subscription` / `already_cancelled` guards, `cancel_at_period_end: true`, return the period end from the Stripe response. It must still write nothing to `subscriptions` and keep `Unauthorized` as a throw.
- [x] 4.3 Add `reactivateSubscriptionAction` as the mirror (`cancel_at_period_end: false`, `not_cancelled` guard).
- [x] 4.4 In `createBillingCheckoutAction`'s in-place `updated` branch, add `cancel_at_period_end: false` to the `stripe.subscriptions.update` call, with a comment explaining that choosing a paid plan is an affirmative act to keep paying.

## 5. UI

- [x] 5.1 Widen `ConfirmDialog`'s `description` prop from `string` to `React.ReactNode` (`src/components/confirm-dialog.tsx`); leave all six existing call sites untouched.
- [x] 5.2 Create `src/app/[lang]/dashboard/photographer/settings/subscription-actions.tsx` (`'use client'`): cancel behind `ConfirmDialog`, reactivate without one, both using `useTransition` + `sonner` toast + `router.refresh()` per `upgrade-plan-button.tsx`. All labels arrive pre-translated via props.
- [x] 5.3 In `settings/billing/page.tsx`, read the subscription with `supabaseAdmin`, compute `hasPendingCancellation`, format the period end with `formatEventDate(..., lang)`, and render inside the current-plan card: the pending notice + Reactivate when pending, a discreet Cancel action otherwise, and nothing at all on Free.
- [x] 5.4 Compute the over-limit warning lines from `getFreePlanOverage` using the `storage.usedGB` / `totals.totalEvents` the page already has, and pass them into the confirmation only for the dimensions that are exceeded.

## 6. i18n

- [x] 6.1 Add the 16 new keys to `photographerDashboard` in `src/dictionaries/en.json` (cancel affordance, dialog title/body + dateless variant, storage and events warnings, confirm/keep/pending labels, success and error toasts, pending notice + dateless variant, reactivate label and its toasts).
- [x] 6.2 Add the same 16 keys to `src/dictionaries/es.json`, matching the file's existing tone.

## 7. Tests

- [x] 7.1 `test/unit/lib/stripe-subscription-period.test.ts` — item present, item absent, non-numeric value.
- [x] 7.2 `test/unit/lib/free-plan-overage.test.ts` — under, exactly at, and over each limit.
- [x] 7.3 `test/unit/actions/subscription-cancel.test.ts` — cancel calls Stripe with `cancel_at_period_end: true`; **the action writes nothing to `subscriptions`** (user-scoped `from` throws in `beforeEach`, and the admin client's `from` is asserted unused); `already_cancelled` and `no_subscription` short-circuit without a Stripe call; reactivate sends `false`; `not_cancelled` guard.
- [x] 7.4 Extend `test/unit/actions/billing-checkout.test.ts` — the in-place plan change sends `cancel_at_period_end: false`.
- [x] 7.5 Extend the `customer.subscription.*` block of `test/integration/api/stripe-webhook.test.ts` — `updated` persists the flag; a later `updated` with `false` clears it; `.deleted` sets `canceled` **and** clears the flag; a yearly subscription persists both the item period end and the flag.
- [x] 7.6 Extend `test/integration/queries/subscriptions.test.ts` — `hasPendingCancellation` is false for a `canceled` row even with the flag set.
- [x] 7.7 Verify with `git stash` that every new test fails on `main` and passes on the branch.

## 8. Docs and verification

- [x] 8.1 Update `CLAUDE.md`: the `cancel_at_period_end` column, the webhook-only-writer rule, the `reactivate` (not `resume`) naming, and the `dashboard-photographer-*` invalidation on subscription state change.
- [x] 8.2 `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green (build is mandatory — `src/lib/` and `queries/` are touched).
- [ ] 8.3 **OPEN — user-triggered gate.** Run `/code-review ultra` over the diff and fix the real findings. It is billed and can only be launched by the user, so it did not run before the commit; the PR stays **draft** until it does. The reviewer must hand-verify that state changes are webhook-driven and that the downgrade destroys no photos.
- [x] 8.4 Record in the PR body: apply migration `20260731000000` to production **by hand via the Supabase MCP** after merge, and the note about the pre-existing user-scoped plan reads that need their own ticket.
