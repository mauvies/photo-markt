import { redirect } from 'next/navigation';
import { getCurrentPlan } from '@/database/queries/subscriptions';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { parsePlanIntent } from '@/lib/billing/plan-intent';
import { localizedPath } from '@/lib/i18n/localized-path';
import { type BillingCheckoutResult, createBillingCheckoutAction } from '../actions';

/**
 * Server-validated resume-to-checkout chokepoint. Reached (only via server
 * redirects — signup / login / callback / onboarding) carrying a chosen plan.
 * The photographer layout has already gated the role; here we re-validate the
 * intent server-side and branch:
 *
 * - Free / invalid / absent  → land on the overview, never write a row.
 * - Already on a paid plan   → billing settings. We must NOT re-run checkout on
 *                              a GET render: for an active subscription that
 *                              takes the in-place `stripe.subscriptions.update`
 *                              (proration) branch, and a refresh/back would fire
 *                              it again. Plan *changes* happen from the settings
 *                              UI with an explicit click.
 * - Paid, no active plan     → create the Stripe checkout (price re-derived
 *                              server-side from plans/env, never the client) and
 *                              hand off to Stripe. Reaching this page does NOT
 *                              activate anything — that's the webhook.
 *
 * On a domain error (Stripe failure / yearly not configured) or an unexpected
 * throw we send the user to the billing settings page with a status code the
 * page turns into a toast.
 */
export default async function BillingResumePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ plan?: string; period?: string }>;
}) {
  const { lang } = await params;
  const sp = await searchParams;
  const intent = parsePlanIntent(sp.plan, sp.period);

  // No intent, or Free → straight to the overview. No subscription row.
  if (!intent || intent.plan === 'free') {
    redirect(localizedPath(lang, '/dashboard/photographer'));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(localizedPath(lang, '/login'));
  }

  // Already subscribed? Don't silently re-checkout / prorate on a GET render —
  // manage plan changes from the settings UI instead. `subscriptions` is
  // system-managed, so this read uses the service-role client.
  const currentPlan = await getCurrentPlan(supabaseAdmin, user.id);
  if (currentPlan.id !== 'free') {
    redirect(localizedPath(lang, '/dashboard/photographer/settings/billing'));
  }

  // Paid intent, no active plan → create the checkout server-side.
  let result: BillingCheckoutResult;
  try {
    result = await createBillingCheckoutAction(intent.plan, intent.period);
  } catch {
    // Unauthorized / Invalid-plan / getUser race throw → controlled fallback
    // (the action redacts thrown messages in prod; the toast is translated).
    redirect(
      localizedPath(lang, '/dashboard/photographer/settings/billing?status=checkout_failed'),
    );
  }

  if ('url' in result) {
    // Trusted Stripe URL from our own action (not user input).
    redirect(result.url);
  }
  if ('updated' in result) {
    redirect(localizedPath(lang, '/dashboard/photographer/settings/billing?status=updated'));
  }
  redirect(localizedPath(lang, `/dashboard/photographer/settings/billing?status=${result.error}`));
}
