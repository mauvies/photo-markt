// Plan-intent preservation across the signup → onboarding → checkout flow.
//
// A chosen plan (and billing period) can arrive from untrusted sources — the
// `?plan=` query string on /signup, the `oauth_redirect_state` cookie, or the
// onboarding URL. These helpers are the single server-side validation
// chokepoint: they whitelist the pair against `plans.ts` (the source of truth)
// and produce an INTERNAL-ONLY resume path. Never build a redirect target from
// a raw client string — always go through `planIntentResumePath`, so an
// attacker can't smuggle an open redirect or a cheaper price into the flow.

import { type BillingPeriod, getPlanById, type PlanId } from '@/lib/plans';

export interface PlanIntent {
  plan: PlanId;
  period: BillingPeriod;
}

/**
 * Where a paid intent resumes into the real Stripe checkout. A server route
 * (under the photographer layout, which gates the role) — never the client.
 */
export const PLAN_INTENT_RESUME_ROUTE = '/dashboard/photographer/billing/resume';

/** Photographer overview — where a free (or absent) intent lands. */
export const PHOTOGRAPHER_OVERVIEW_PATH = '/dashboard/photographer';

/**
 * Whitelist a raw `(plan, period)` pair. Returns null when `plan` is not a real
 * plan id — the caller treats that as "no plan intent". `period` is constrained
 * to the two known values and defaults to monthly, so a caller can't smuggle an
 * arbitrary string toward the Stripe price lookup.
 */
export function parsePlanIntent(
  plan: string | null | undefined,
  period: string | null | undefined,
): PlanIntent | null {
  // getPlanById validates membership in PLANS (free|starter|pro) by value.
  if (!plan || !getPlanById(plan as PlanId)) return null;
  const validPeriod: BillingPeriod = period === 'yearly' ? 'yearly' : 'monthly';
  return { plan: plan as PlanId, period: validPeriod };
}

/**
 * A plan is "paid" iff it has a pricing config. `pricing === null` is the Free
 * plan — the same single-source-of-truth signal used everywhere else — so a new
 * paid tier is picked up automatically.
 */
export function isPaidPlan(plan: PlanId): boolean {
  const config = getPlanById(plan);
  return !!config && config.pricing !== null;
}

/**
 * The internal path a validated intent resumes to. Free → the overview (no
 * subscription row is ever written for Free). Paid → the server-side resume
 * route carrying the whitelisted plan + period. Always same-origin, never a URL
 * derived from client input.
 */
export function planIntentResumePath(intent: PlanIntent): string {
  if (!isPaidPlan(intent.plan)) {
    return PHOTOGRAPHER_OVERVIEW_PATH;
  }
  const params = new URLSearchParams({ plan: intent.plan, period: intent.period });
  return `${PLAN_INTENT_RESUME_ROUTE}?${params.toString()}`;
}
