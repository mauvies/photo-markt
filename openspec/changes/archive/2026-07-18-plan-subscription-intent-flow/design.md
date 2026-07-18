## Context

Verified in prod (`yzdlueeeizdqwuicydbr`): `public.subscriptions` has `rowsecurity = true` and **zero** policies and **zero** CHECK constraints. It is a service-role-only, system-managed table (same model as `admin_users` / `rate_limit_buckets`). All correct writes already go through `supabaseAdmin` in the Stripe webhook. Two paths regressed by getting a user-scoped client:

- `createBillingCheckoutAction` (`billing/actions.ts`): `getSubscription(supabase, …)` (silently returns null under RLS) and `supabase.from('subscriptions').insert(…)` (denied → `42501` → `checkout_failed`). This breaks **every** paid checkout — the logged-in pricing CTA and the post-signup `UpgradeHandler` alike.
- `cancelSubscriptionAction`: same user-scoped `getSubscription` → always "no active subscription".

The intent handoff is also structurally broken independent of RLS: the OAuth callback redirects a plan-intent user to `/dashboard/photographer/settings?upgrade=…`, but `settings/page.tsx` unconditionally `redirect`s to `/settings/profile`, dropping the query param before `UpgradeHandler` (which lives on `/settings/billing`) can run. And a brand-new user has no role, so the photographer layout bounces them to `/onboarding/role` first, which knows nothing about plan intent.

## Goals / Non-Goals

**Goals:**
- Make paid checkout work again by using the service-role client for `subscriptions` reads/writes in the billing actions — without weakening RLS.
- Preserve a chosen plan across Google signup → onboarding → checkout, with a single, server-validated resume chokepoint.
- Land the user on the overview in a success state that tolerates the redirect↔webhook gap; keep activation webhook-only.

**Non-Goals:**
- No DB migration or RLS policy changes (prod RLS is already correct; adding a policy would be the wrong fix).
- No CAPTCHA / anti-automation (unrelated).
- No change to how the webhook activates subscriptions (`customer.subscription.*` via `supabaseAdmin`) — already correct.
- Not touching the vestigial `src/app/api/billing/checkout/route.ts` (no callers); noted, left as-is to keep scope tight.

## Decisions

**1. Service-role client for subscription reads/writes in billing actions.** `createBillingCheckoutAction` and `cancelSubscriptionAction` keep `supabase.auth.getUser()` on the user-scoped client (identity), but every `subscriptions` read/insert switches to `supabaseAdmin`, always scoped by the resolved `user.id`. This matches CLAUDE.md's "service-role for system-managed state" rule and the webhook precedent. *Alternative rejected:* adding an `authenticated` RLS policy — explicitly forbidden by the ticket (would let user-scoped clients write system-managed billing state).

**2. Pure `plan-intent.ts` helper as the validation chokepoint.** `parsePlanIntent(plan, period)` whitelists against `getPlanById` (single source of truth) and returns `{ plan, period } | null`; `isPaidPlan(plan)` keys off `plan.pricing !== null`; `planIntentResumePath(intent)` returns an **internal** path (overview for free, `/dashboard/photographer/billing/resume?plan=…&period=…` for paid). Pure → unit-tested without a DB, and centralizes the "no open redirect / no client price" guarantees. *Alternative rejected:* re-deriving the whitelist inline at each call site (callback, onboarding, signup) — that's exactly how the current `?upgrade=` checks drifted.

**3. A dedicated resume route does the actual checkout.** `/dashboard/photographer/billing/resume/page.tsx` (under the photographer layout, which already gates role) parses the intent, sends free/invalid to the overview (no row), and for paid calls `createBillingCheckoutAction` server-side then `redirect`s to the returned Stripe URL (or to `/settings/billing?status=<code>` on a domain error). Reusing the action means the price is re-derived server-side every time. *Alternative rejected:* keeping `?upgrade=` + `UpgradeHandler` — it's doubly broken (param stripped by the `/settings` redirect; RLS-failing) and leaves a confusing second mechanism.

**4. Thread intent through onboarding, not around it.** Callback: onboarded + intent → resume path; not-onboarded + intent → `/onboarding/role?plan=…&period=…`. `completeOnboarding` gains an optional `checkoutIntent`; after writing the role it redirects a **photographer** with a paid intent to the resume path (talent ignores the plan — a plan only makes sense for photographers). Backward-compatible (optional param).

**5. Webhook-only activation with a polling banner.** `success_url` → `/dashboard/photographer?checkout=success`; a client banner polls a new `getSubscriptionStatusAction` (reads `getCurrentPlan` via `supabaseAdmin`) every ~2.5s until the plan is a paid one, then shows success and `router.refresh()`s; a bounded number of polls then a "still processing" fallback. The banner never activates anything. `cancel_url` → `/settings/billing?status=cancelled`.

## Risks / Trade-offs

- [An `incomplete` row persists if the user cancels] → `getCurrentPlan` treats `incomplete` as Free, so no access is granted; the row lets a retry reuse the same Stripe customer. Acceptable, matches "no partial state" (no access granted).
- [Soft-delete-style silent miss if a future subscription write forgets `supabaseAdmin`] → the new security regression test asserts the user-scoped client is denied (42501), and the billing-checkout unit test asserts the insert/read go through the admin client — both fail loudly if someone reverts to the user-scoped client.
- [Banner polls the DB up to N times] → bounded (≈10 polls / 25s) and only on the `checkout=success` return; negligible cost, and the webhook typically lands within seconds.
- [Removing `UpgradeHandler`] → nothing sends `?upgrade=` after this change; the removal is verified by grep + typecheck. The in-dashboard upgrade CTAs (`UpgradePlanButton`, `AvailablePlansSection`) call the action directly and are unaffected.
