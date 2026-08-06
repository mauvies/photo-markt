/**
 * Report something that went wrong on a money path (T-215).
 *
 * The payout code is written so that a failure never throws into the Stripe
 * webhook — a 500 there makes Stripe redeliver a money operation, which is worse
 * than the failure itself. The cost of that discipline is that failures become
 * silent unless something deliberately surfaces them, and until now the highest
 * severity line in the system (`POSSIBLE DOUBLE PAYMENT` in `payouts.ts`) was a
 * bare `console.error`.
 *
 * This is that surface. It is the only thing standing between a failed clawback
 * and nobody ever knowing, so it follows two rules absolutely:
 *
 *   1. **It never throws.** Every channel is wrapped; observability that breaks
 *      the request path it observes is worse than no observability.
 *   2. **It carries no PII.** The app sets `sendDefaultPii: false`
 *      (`src/lib/observability/sentry.ts`); ids of charges, payouts and orders are
 *      fine — buyer emails and names are not, and are never passed in.
 *
 * Pattern (lazy import, stable fingerprint, subsystem tags) mirrors the limiter's
 * `reportBackendError` in `src/lib/rate-limit.ts`, which is the existing precedent
 * for a manual Sentry capture in this codebase. Deliberately NOT throttled: unlike
 * a limiter backend outage, a money incident is rare and every occurrence is worth
 * its own event.
 */

export type MoneyIncidentKind =
  /** A dispute was opened against a purchase. */
  | 'dispute-opened'
  /** A dispute was lost — money and access are gone. */
  | 'dispute-lost'
  /** A dispute was won — access restored. */
  | 'dispute-won'
  /** A transfer reversal could not be created (insufficient balance, API error). */
  | 'reversal-failed'
  /** A payout could not be resolved automatically and needs a human. */
  | 'needs-reconciliation';

export interface MoneyIncident {
  kind: MoneyIncidentKind;
  /** One line, human first — this is what lands in an alert. */
  message: string;
  /**
   * Identifiers only: charge / payout / order / photographer ids, amounts.
   * Never an email, a name, or anything else that identifies the buyer.
   */
  context?: Record<string, string | number | null | undefined>;
  /** The underlying error, when there was one. */
  cause?: unknown;
}

export async function reportMoneyIncident(incident: MoneyIncident): Promise<void> {
  const { kind, message, context, cause } = incident;

  // Always log first: the console line is the one channel that cannot itself
  // fail, and it is what a `vercel logs` search finds during an incident.
  console.error(`[money:${kind}] ${message}`, { ...context, cause });

  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(cause instanceof Error ? cause : new Error(`[${kind}] ${message}`), {
      level: 'error',
      // Group by incident kind, not by message: the messages carry ids, so
      // fingerprinting on them would make every occurrence its own issue.
      fingerprint: ['money-incident', kind],
      tags: { subsystem: 'payouts', incident: kind },
      extra: { message, ...context },
    });
  } catch (sentryErr) {
    console.error('[money] failed to report incident to Sentry', sentryErr);
  }
}
