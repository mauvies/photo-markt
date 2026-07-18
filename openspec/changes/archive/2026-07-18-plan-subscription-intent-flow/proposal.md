## Why

A logged-out photographer who picks a plan on `/photographers` has **no working path to subscribe** today — neither Free nor paid. Two defects compound: (1) `createBillingCheckoutAction` reads and inserts `subscriptions` with the **user-scoped** Supabase client, but that table has RLS enabled with **zero policies** (a service-role-only, system-managed table — verified in prod), so every insert fails with `42501` and every read silently returns null → the paid checkout is entirely broken; (2) the post-signup handoff redirects to `/dashboard/photographer/settings?upgrade=…`, but the `/settings` index unconditionally redirects to `/settings/profile`, **stripping the query param**, and a brand-new user (no role yet) is bounced to onboarding first — so the plan intent dies before checkout ever runs.

## What Changes

- **Fix the RLS `42501` root cause** (no RLS weakening): subscription reads/writes in `createBillingCheckoutAction` and `cancelSubscriptionAction` move to `supabaseAdmin` (service role). The auth check stays on the user-scoped client. `subscriptions` remains service-role-only — matching the documented `admin_users` / `rate_limit_buckets` pattern.
- **New pure helper `src/lib/billing/plan-intent.ts`**: whitelists a raw `(plan, period)` pair against `plans.ts` (`free|starter|pro`, `monthly|yearly`) and produces an **internal-only** resume path. No open redirect; price/plan always re-derived server-side from the single source of truth.
- **New server-validated resume route** `/dashboard/photographer/billing/resume`: Free → land on the overview with **no** subscription row written; paid → create the Stripe checkout server-side and redirect to Stripe.
- **Thread plan intent through signup**: the OAuth callback routes a not-yet-onboarded plan-intent user to `/onboarding/role?plan=…&period=…` and an already-onboarded one straight to the resume route; `completeOnboarding` resumes a photographer's intent after role assignment. The Free pricing CTA carries `?plan=free`.
- **BREAKING (internal handoff)**: the `?upgrade=` mechanism and the now-dead `UpgradeHandler` client component are removed; all plan handoffs go through the resume route.
- **Post-payment return + gap tolerance**: `success_url` → `/dashboard/photographer?checkout=success` with a client banner that polls the current plan (read via admin) until the **webhook** activates it; activation is always the webhook, never the `success_url`. `cancel_url` → `/settings/billing?status=cancelled` (sensible retry surface, no partial state).

## Capabilities

### New Capabilities
- `plan-subscription-intent`: preserving a photographer's chosen plan across signup/onboarding, the server-validated resume-to-checkout path, the RLS-correct subscription write model, and the post-payment success/gap-tolerant return.

### Modified Capabilities
<!-- None — no existing OpenSpec capability spec governs this flow yet. -->

## Impact

- **Code**: `src/lib/billing/plan-intent.ts` (new); `src/app/[lang]/dashboard/photographer/billing/actions.ts` (admin client, success/cancel URLs, status action); `src/app/[lang]/dashboard/photographer/billing/resume/page.tsx` (new); `src/app/auth/callback/route.ts`; `src/app/[lang]/onboarding/role/page.tsx`; `src/app/[lang]/actions/roles.ts` (`completeOnboarding` optional intent); `src/app/[lang]/signup/page.tsx`; `src/components/pricing-plan-button.tsx`; `src/app/[lang]/dashboard/photographer/page.tsx` + a new confirming banner; `src/app/[lang]/dashboard/photographer/settings/billing/page.tsx` (remove `UpgradeHandler`, add status toast); delete `upgrade-handler.tsx`.
- **i18n**: new `photographerDashboard` strings in `en.json` + `es.json`.
- **DB**: none — RLS is already correct in prod; this is a client-selection fix, not a schema change.
- **Security**: server-side whitelist validation, internal-only redirects, price from `plans.ts`; subscription writes stay service-role-only.
