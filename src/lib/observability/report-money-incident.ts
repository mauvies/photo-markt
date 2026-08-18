import { env } from '@/env.mjs';

/**
 * Report something that went wrong on a money path (T-215, T-249).
 *
 * The payout code is written so that a failure never throws into the Stripe
 * webhook — a 500 there makes Stripe redeliver a money operation, which is worse
 * than the failure itself. The cost of that discipline is that failures become
 * silent unless something deliberately surfaces them. That is not theoretical:
 * a real sale on 2026-07-28 completed with zero `payouts` rows and nobody knew
 * for thirteen days (T-249).
 *
 * This is that surface. It is the only thing standing between money that never
 * moved and nobody ever knowing, so it follows two rules absolutely:
 *
 *   1. **It never throws.** Every channel is wrapped; observability that breaks
 *      the request path it observes is worse than no observability.
 *   2. **It carries no PII.** The app sets `sendDefaultPii: false`
 *      (`src/lib/observability/sentry.ts`); ids of charges, payouts and orders are
 *      fine — buyer emails and names are not, and are never passed in.
 *
 * Pattern (lazy import, stable fingerprint, subsystem tags) mirrors the limiter's
 * `reportBackendError` in `src/lib/rate-limit.ts`, which is the existing precedent
 * for a manual Sentry capture in this codebase.
 *
 * Two channels, and only the email one is throttled (T-249). Sentry groups by
 * `fingerprint`, so every occurrence adds signal without adding noise, and a
 * money incident is rare enough to be worth its own event. Email does not group:
 * one Supabase outage fires the webhook's catch once per photographer per order,
 * which is an inbox flood rather than an alert. The console line and the Sentry
 * event always go out; only the email is damped.
 */

/**
 * Per-process damper on the email channel, mirroring the limiter's
 * `FAIL_ALERT_THROTTLE_MS` (`src/lib/rate-limit.ts`). Serverless gives each
 * instance its own copy, so this bounds volume during an outage rather than
 * enforcing an exact rate — which is all it needs to do.
 */
const EMAIL_ALERT_THROTTLE_MS = 60_000;

/**
 * Keyed by `kind`, not global: a `payout-not-recorded` burst must not suppress a
 * `dispute-lost` a few seconds later. Those are different incidents, and the
 * throttle exists to collapse *duplicates*, not distinct alerts.
 */
const lastEmailAlertMsByKind = new Map<MoneyIncidentKind, number>();

/**
 * The alert rides inside the Stripe webhook, so it must not be able to extend
 * the handler past Stripe's delivery timeout and cause a redelivery of a money
 * operation. A hung Resend call is bounded here rather than left to run.
 */
const EMAIL_SEND_TIMEOUT_MS = 5_000;

/**
 * ⚠️ Only `payout-not-recorded` has a producer on `main` today. The five
 * dispute/reversal kinds are **inherited deliberately** from the parked T-215 /
 * PR #290 branch, which this file was rescued from rather than rewritten:
 * deleting them would guarantee a conflict when that branch resumes, and would
 * split the reporter into two divergent implementations — the exact thing
 * keeping one file avoids. Do not treat them as dead code to prune.
 */
export type MoneyIncidentKind =
  /** A dispute was opened against a purchase. (T-215 — no producer yet.) */
  | 'dispute-opened'
  /** A dispute was lost — money and access are gone. (T-215 — no producer yet.) */
  | 'dispute-lost'
  /** A dispute was won — access restored. (T-215 — no producer yet.) */
  | 'dispute-won'
  /** A reversal could not be created (insufficient balance, API error). (T-215 — no producer yet.) */
  | 'reversal-failed'
  /** A payout needs a human to resolve it. (T-215 — no producer yet.) */
  | 'needs-reconciliation'
  /**
   * A sale skipped the photographer's transfer and left no recoverable debt
   * (T-249) — the ledger row could not be opened at all, or a failed transfer
   * could not be parked as a hold and its row is stranded `processing` with no
   * `transfer_batch_id`, which neither `listPayableHolds` nor
   * `listStaleProcessingBatches` will ever pick up.
   */
  | 'payout-not-recorded';

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
  // `context` spread first, for the same reason as the Sentry `extra` below: a
  // caller's arbitrary key must never shadow `cause`. The two orderings have to
  // agree, or the same incident reads differently in the two channels.
  console.error(`[money:${kind}] ${message}`, { ...context, cause });

  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(cause instanceof Error ? cause : new Error(`[${kind}] ${message}`), {
      level: 'error',
      // Group by incident kind, not by message: the messages carry ids, so
      // fingerprinting on them would make every occurrence its own issue.
      fingerprint: ['money-incident', kind],
      tags: { subsystem: 'payouts', incident: kind },
      // `context` is spread FIRST so a caller can never shadow `message` or
      // `reason` — the incident's own fields must win over an arbitrary key.
      extra: { ...context, message, reason: describeCause(cause) },
    });
  } catch (sentryErr) {
    console.error('[money] failed to report incident to Sentry', sentryErr);
  }

  await sendEmailAlert(kind, message, context, cause);
}

/**
 * Render `cause` as text for the channels that cannot carry an object.
 *
 * ⚠️ Not every cause is an `Error`. PostgREST hands back a **plain object**
 * (`postgrest-js` only builds a `PostgrestError` when `shouldThrowOnError` is
 * set), so `cause instanceof Error` is false for exactly the database failures
 * this reporter exists to explain — and its `message`/`details`/`hint` would be
 * dropped, leaving an alert that says something failed but never why.
 */
function describeCause(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === 'object') {
    const { message, code, details, hint } = cause as Record<string, unknown>;
    const parts = [code, message, details, hint].filter(
      (part): part is string | number => part !== undefined && part !== null && part !== '',
    );
    if (parts.length > 0) return parts.join(' · ');
  }
  return String(cause);
}

/**
 * The second channel. Absent `MONEY_ALERT_EMAIL` this is a no-op, the same way
 * an absent `SENTRY_DSN` disables the SDK — so local dev, the test run, and
 * previews stay silent without any extra gating.
 *
 * Lazy import: `send-money-alert.ts` constructs a `Resend` client at module
 * scope, and a static import would run that in every test that merely touches
 * this reporter.
 */
async function sendEmailAlert(
  kind: MoneyIncidentKind,
  message: string,
  context: MoneyIncident['context'],
  cause: unknown,
): Promise<void> {
  const to = env.MONEY_ALERT_EMAIL;
  // `''` is a configured-but-empty value (see env.mjs) and means "not set".
  if (!to) return;

  const now = Date.now();
  const last = lastEmailAlertMsByKind.get(kind) ?? 0;
  if (now - last < EMAIL_ALERT_THROTTLE_MS) return;

  // Claim the window BEFORE sending, so a burst can't fire N concurrent Resend
  // calls and stall the webhook by their combined latency...
  lastEmailAlertMsByKind.set(kind, now);

  try {
    const { sendMoneyAlertEmail } = await import('@/lib/email/send-money-alert');
    await withTimeout(
      sendMoneyAlertEmail({ to, kind, message, context, reason: describeCause(cause) }),
      EMAIL_SEND_TIMEOUT_MS,
    );
  } catch (emailErr) {
    console.error('[money] failed to send incident alert email', emailErr);

    // ...but release it on a fast failure, so one bad send doesn't silence the
    // next incident for a full window. The face-search 50% alert releases its
    // claim bucket the same way (`events/[shareCode]/actions.ts`).
    //
    // ⚠️ NOT on a timeout. Releasing there would undo the protection
    // `EMAIL_SEND_TIMEOUT_MS` exists for: with Resend hanging, every incident in
    // a burst would re-claim and wait the full timeout in series, adding 5 s × N
    // to a webhook that must answer inside Stripe's delivery window — and a
    // redelivered money event is worse than a missed email. A fast API error
    // costs nothing to retry; a hang is precisely what must stay throttled.
    if (!(emailErr instanceof AlertTimeoutError) && lastEmailAlertMsByKind.get(kind) === now) {
      lastEmailAlertMsByKind.delete(kind);
    }
  }
}

/** Distinguishes "Resend is hanging" from "Resend said no" for the throttle. */
class AlertTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AlertTimeoutError(`timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}
