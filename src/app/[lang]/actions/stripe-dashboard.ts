'use server';

import { getProfileStripeConnect } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import { createExpressLoginLink } from '@/lib/stripe/connect';

/** Why a photographer cannot be sent to their Stripe dashboard right now. */
export type StripeDashboardError = 'not_connected' | 'not_ready' | 'stripe_unavailable';

export type StripeDashboardResult =
  | { ok: true; url: string }
  | { ok: false; error: StripeDashboardError };

/**
 * Mint a one-time link into the photographer's own Stripe Express dashboard
 * (T-244).
 *
 * An Express account has no password and no login page of its own, so this link
 * is the *only* way its owner can reach it. Nothing minted one before, which left
 * a photographer able to see a balance in our UI with no way to check when it
 * lands in their bank, what their payout schedule is, or which transfers make up
 * the number.
 *
 * ⚠️ **The account id is read from the caller's OWN profile and is never accepted
 * as a parameter.** The link authenticates whoever holds it into that Stripe
 * account — payouts, bank details, balance — so taking an id from the client
 * would be a self-service door into any photographer's money. There is no
 * legitimate reason for this action to take an argument, which is why it has
 * none: the absence is the safety property.
 *
 * The URL is short-lived and single-use, so it is minted per click and must never
 * be stored, cached or logged.
 *
 * Returns the failure instead of throwing, like the role and avatar actions: Next
 * redacts thrown Server Action messages in production (T-189), so a throw could
 * not tell the photographer which of the three cases they are in.
 */
export async function createStripeDashboardLinkAction(): Promise<StripeDashboardResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'not_connected' };

  const connect = await getProfileStripeConnect(supabase, user.id);
  const accountId = connect?.stripe_connect_account_id ?? null;
  if (!accountId) return { ok: false, error: 'not_connected' };

  // Stripe refuses a login link for an account that has not finished onboarding.
  // Keeping "never started" and "started and stopped" apart matters: they need
  // different copy and send the photographer to different places.
  if (connect?.stripe_connect_status !== 'active') return { ok: false, error: 'not_ready' };

  try {
    return { ok: true, url: await createExpressLoginLink(accountId) };
  } catch (err) {
    console.error(`[connect] failed to create a Stripe login link for ${user.id}:`, err);
    return { ok: false, error: 'stripe_unavailable' };
  }
}
