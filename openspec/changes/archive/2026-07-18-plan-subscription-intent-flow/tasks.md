## 1. RLS fix (service-role for subscriptions)

- [x] 1.1 In `billing/actions.ts`, switch the `subscriptions` read + insert in `createBillingCheckoutAction` to `supabaseAdmin` (keep `supabase.auth.getUser()` on the user-scoped client)
- [x] 1.2 Switch the `getSubscription` read in `cancelSubscriptionAction` to `supabaseAdmin`
- [x] 1.3 Update `test/unit/actions/billing-checkout.test.ts` to mock `@/database/supabase-admin`; assert the subscription read/insert go through the admin client and never the user-scoped `from`

## 2. Plan-intent helper + resume route

- [x] 2.1 Create `src/lib/billing/plan-intent.ts`: `parsePlanIntent`, `isPaidPlan`, `planIntentResumePath` (whitelist via `plans.ts`, internal-only path)
- [x] 2.2 Unit test `test/unit/lib/billing/plan-intent.test.ts` (unknown plan → null, free → overview, paid → resume path, period defaults monthly, no external URL)
- [x] 2.3 Create `/dashboard/photographer/billing/resume/page.tsx`: free/invalid → overview (no row), paid → `createBillingCheckoutAction` → redirect to Stripe, domain error → `/settings/billing?status=<code>`

## 3. Thread intent through signup / callback / onboarding

- [x] 3.1 `auth/callback/route.ts`: replace the `?upgrade=` branch — onboarded + intent → resume path; not-onboarded + intent → `/onboarding/role?plan=…&period=…`
- [x] 3.2 `onboarding/role/page.tsx`: read `plan`/`period` from searchParams and pass the intent into `completeOnboarding`
- [x] 3.3 `roles.ts`: `completeOnboarding` gains optional `checkoutIntent`; photographer + paid intent → redirect to resume path (talent/free unchanged)
- [x] 3.4 `signup/page.tsx`: logged-in-with-plan branch redirects via `planIntentResumePath` instead of `settings?upgrade=`
- [x] 3.5 `pricing-plan-button.tsx`: Free CTA carries `?plan=free`
- [x] 3.6 Integration test: `completeOnboarding` with a paid intent redirects a photographer to the resume path; free/talent land on the dashboard

## 4. Post-payment return + gap tolerance

- [x] 4.1 `billing/actions.ts`: `success_url` → `/dashboard/photographer?checkout=success`; `cancel_url` → `/settings/billing?status=cancelled`; add `getSubscriptionStatusAction` (plan via admin)
- [x] 4.2 Add `SubscriptionConfirmingBanner` client component (polls status, confirming → active, bounded fallback) + render it on the overview when `checkout=success`
- [x] 4.3 Remove `<UpgradeHandler>` from `settings/billing/page.tsx`, delete `upgrade-handler.tsx`, add a small `?status=` toast on billing settings

## 5. Security regression + i18n + green

- [x] 5.1 Integration security test `test/integration/security/subscriptions-rls.test.ts`: user-scoped insert/select denied (42501 / 0 rows), service-role allowed
- [x] 5.2 Add new strings to `en.json` + `es.json` (confirming, active, taking longer, checkout cancelled/failed)
- [x] 5.3 `pnpm typecheck && pnpm lint && pnpm test` (+ `pnpm build`) green; run `/code-review` (payments/auth) and fix real findings
