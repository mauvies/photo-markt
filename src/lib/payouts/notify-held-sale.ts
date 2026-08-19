import {
  countOutstandingConnectInactiveHolds,
  getTotalPendingPayouts,
} from '@/database/queries/payouts';
import type { SupabaseServerClient } from '@/database/queries/types';
import { env } from '@/env.mjs';
import { PLATFORM_CURRENCY_CODE } from '@/lib/currency';

/**
 * Tell a photographer, by email, that a sale is waiting on their payout account
 * (T-250).
 *
 * Runs from the Stripe webhook right after a `connect_inactive` hold is opened.
 * Two absolutes, both inherited from the ledger code around it:
 *
 *   1. **It never throws.** The buyer has already paid. A Resend outage — or a
 *      failed lookup — must not turn into a 500, because Stripe answers a 500 by
 *      redelivering a money event. Every failure is logged and swallowed here,
 *      so the caller cannot get this wrong either.
 *   2. **No buyer PII.** The photographer is told an amount, nothing about who
 *      bought or what.
 *
 * ⚠️ Not to be confused with `reportMoneyIncident` (T-249). That alerts **us**
 * about a failure; this tells the **photographer** about a perfectly normal
 * state. Different recipient, different severity — deliberately not merged into
 * one mechanism.
 */

/** What happened, for the caller's log line and for tests. */
export type HeldSaleNotifyOutcome =
  /** Sent. */
  | 'sent'
  /** They were already in a holding streak — see `countOutstandingConnectInactiveHolds`. */
  | 'skipped_already_notified'
  /** No address on the account, or the lookup failed. */
  | 'skipped_no_email'
  /** Something failed; already logged. */
  | 'failed';

export async function notifyPhotographerOfHeldSale(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<HeldSaleNotifyOutcome> {
  try {
    // The anti-spam rule. The row for THIS sale is already open, so a count of
    // exactly 1 means this sale started the streak. Anything higher and they
    // have been told; 40 sold photos must not be 40 emails.
    //
    // Being DB-derived rather than in-process is what makes it hold at all:
    // each webhook delivery is its own serverless invocation, so an in-memory
    // flag would dedupe nothing. Two truly concurrent first sales could both
    // read 1 and send twice — bounded, rare, and far better than the reverse.
    const outstanding = await countOutstandingConnectInactiveHolds(supabase, photographerId);
    if (outstanding !== 1) return 'skipped_already_notified';

    const email = await resolvePhotographerEmail(supabase, photographerId);
    if (!email) {
      console.warn(
        `[payouts] no email for photographer ${photographerId}; held-sale notice skipped.`,
      );
      return 'skipped_no_email';
    }

    // The SAME figure the dashboard banner and the Earnings alert quote
    // (`getTotalPendingPayouts`), so an email and the screen it points at can't
    // disagree about how much is waiting.
    const heldCents = await getTotalPendingPayouts(supabase, photographerId);

    const { sendHeldSaleEmail } = await import('@/lib/email/send-held-sale-email');
    await sendHeldSaleEmail({
      to: email,
      heldAmount: formatCents(heldCents),
      // No locale segment: `src/proxy.ts` resolves one from the reader's own
      // cookie / `Accept-Language`, which is better than guessing here.
      payoutSettingsUrl: `${env.SITE_URL}/dashboard/photographer/settings/payout-profile`,
    });

    return 'sent';
  } catch (err) {
    console.error(`[payouts] held-sale notice failed for photographer ${photographerId}:`, err);
    return 'failed';
  }
}

/**
 * The address lives in `auth.users`, not `profiles`. Resolved server-side from
 * an id we already hold, via the existing service-role RPC — CLAUDE.md's rule,
 * and the reason no surface has to expose it.
 */
async function resolvePhotographerEmail(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_user_emails_batch', {
    user_ids: [photographerId],
  });

  if (error) {
    console.error(`[payouts] email lookup failed for photographer ${photographerId}:`, error);
    return null;
  }

  return data?.[0]?.email ?? null;
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: PLATFORM_CURRENCY_CODE,
  }).format(cents / 100);
}
