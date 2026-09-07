import { env } from '@/env.mjs';
import { resolveMoneyAlertRecipient } from './money-alert-channels';

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
 * Every kind has a producer: the webhook raises the dispute, refund and
 * order-assembly ones, `apply-clawback.ts` raises `reversal-failed`,
 * `retry-pending-payouts.ts` raises the three sweep kinds, and
 * `reconcile-order-payouts.ts` raises `order-without-payouts` plus, from its
 * `onFailure`, `payout-reconciliation-failed`.
 *
 * ⚠️ **A kind is never shared to save one.** The Sentry fingerprint is
 * `['money-incident', kind]` and the email throttle is keyed on `kind`, so two
 * distinct problems under one kind collapse into a single issue and the first to
 * fire silences the other for the window (T-264). Add a kind whenever the
 * remediation differs — especially for a recovery sweep, which alerts about a
 * STATE and would otherwise mask its neighbours.
 */
export type MoneyIncidentKind =
  /** A dispute was opened against a purchase (T-215). */
  | 'dispute-opened'
  /** A dispute was lost — money and access are gone (T-215). */
  | 'dispute-lost'
  /** A dispute was won — access restored (T-215). */
  | 'dispute-won'
  /** A reversal could not be created (insufficient balance, API error) — T-215. */
  | 'reversal-failed'
  /** A payout needs a human to resolve it (T-215). */
  | 'needs-reconciliation'
  /**
   * A sale skipped the photographer's transfer and left no recoverable debt
   * (T-249) — the ledger row could not be opened at all, or a failed transfer
   * could not be parked as a hold and its row is stranded `processing` with no
   * `transfer_batch_id`, which neither `listPayableHolds` nor
   * `listStaleProcessingBatches` will ever pick up.
   */
  | 'payout-not-recorded'
  /**
   * A paid order's delivery email could not be sent (T-253).
   *
   * The guest case is the sharp one: a guest has no account, so that email IS
   * the delivery of what they paid for — money in, nothing out, and no trace
   * unless this fires. Not a payout failure, so it carries its own remediation
   * text and subsystem tag.
   */
  | 'purchase-email-not-delivered'
  /**
   * A reversal was reserved on a payout row but never confirmed with Stripe
   * (T-264) — the invocation died between `reservePayoutReversal` and
   * `confirmPayoutReversal`.
   *
   * The row over-reports what came back, so `getTotalPaidOut` (net of reversals)
   * understates the photographer's balance permanently, and every later delta
   * computes `target − already` = 0, silently no-opping the next legitimate
   * reversal. Nothing else selects such a row.
   *
   * ⚠️ Its OWN kind, not `needs-reconciliation`. The Sentry fingerprint is
   * `['money-incident', kind]` and the email throttle is keyed per kind, so
   * sharing one kind across the sweeps would collapse four distinct problems into
   * one issue and let whichever fires first silence the others.
   */
  | 'reversal-unconfirmed'
  /**
   * A dispute opened and the charge's outstanding holds could NOT be frozen
   * (T-265).
   *
   * The rows keep their `hold_reason` and charge id with no freeze mark, so
   * `listPayableHolds` still selects them and the retry cron will pay money that
   * is under dispute. Nothing local can retry it — a freeze that failed and a
   * charge that was never disputed look identical from the ledger — so the only
   * honest retry is a later `charge.dispute.updated`, which re-runs the same
   * idempotent body.
   */
  | 'dispute-freeze-failed'
  /**
   * A dispute closed without loss and the freeze could NOT be released (T-265).
   *
   * The mirror of `dispute-freeze-failed`, and the more expensive one:
   * `listPayableHolds` refuses every row carrying `frozen_by_dispute_id` and
   * `restoreHoldsForCharge` is its only writer, so the debt is real, recorded and
   * permanently unpayable — while the photographer is still shown a balance for
   * it. The `release-stale-dispute-freezes` sweep is the recovery path.
   *
   * ⚠️ Its OWN kind, opposite to the one above: one leaves money payable that
   * must not be paid, the other leaves money unpayable that must be. Sharing a
   * kind would let a burst of one silence the other (the fingerprint and the
   * email throttle are both keyed on `kind`).
   */
  | 'dispute-unfreeze-failed'
  /**
   * Payout holds are still frozen long after their dispute should have resolved,
   * and the sweep could not establish why (T-265).
   *
   * Raised only for what the sweep could NOT resolve: a dispute Stripe would not
   * return, or one that no longer exists there. A dispute Stripe reports as still
   * open is not stuck, and one it reports as lost is correctly frozen forever —
   * neither is reported. Aggregated over the whole set and claimed once per
   * rolling day, because the cron runs 48×/day and this state does not fix
   * itself.
   */
  | 'dispute-freeze-stuck'
  /**
   * A payout hold has been outstanding beyond its window and the retry worker
   * cannot drain it (T-254).
   *
   * The worker's failure exits deliberately never throw — a `transfer_failed`
   * hold whose transfer fails on every pass, or a row wedged `processing` by a
   * perpetually inconclusive probe, is retried every 30 minutes forever with
   * nothing but a console line. This kind is the state those exits cannot
   * surface themselves: raised by a sweep, aggregated over the whole set, and
   * claimed at most once per rolling day (the cron runs 48×/day and a stuck
   * hold does not fix itself). It also covers recorded debt that has been
   * waiting on an external condition (`connect_inactive`, `below_minimum`) for
   * over a month — legitimate short-term, but past that it is money nothing
   * will ever move on its own.
   *
   * Reported, never repaired, and the alert must never instruct a manual
   * transfer: zero drained rows proves nothing is *about* to be paid — the
   * `payouts` ledger stays the authority (same rule as T-249/T-255).
   *
   * ⚠️ Its OWN kind, per T-264 (explicitly binding on T-254): the fingerprint
   * and the email throttle are keyed on `kind`, so folding this into
   * `needs-reconciliation` or a neighbouring sweep would collapse distinct
   * problems into one issue and let the first firing silence the rest.
   */
  | 'payout-hold-stuck'
  /**
   * The stuck-hold sweep itself could not read the ledger (T-254).
   *
   * ⚠️ An alert about a **missing check**, not about a row — the same shape as
   * `payout-reconciliation-failed`, and needed for a sharper reason. That sweep
   * lets its queries throw, which at least fails the Inngest run; this one runs
   * BEFORE the paying steps, so it must swallow read errors or a statement
   * timeout would stop every payout in the run. The cost of swallowing is that
   * the step then *succeeds*: a wedged query (timeout on the window scan, a
   * schema-cache blip, a revoked grant) would silence the stuck-hold alert
   * permanently while every dashboard looked healthy — the T-125 shape, where
   * production quietly ran 5 of 13 registered functions.
   *
   * Its OWN kind, per T-264: the remediation is "go fix the sweep", which shares
   * nothing with "go reconcile this hold". Claimed once per rolling day like the
   * state it guards, because the cron runs 48×/day.
   */
  | 'payout-hold-sweep-failed'
  /**
   * A paid order left NO row in `payouts` at all (T-255).
   *
   * The mirror image of `payout-not-recorded`, and the reason both exist: that
   * one fires from inside a known exit as the code walks past it, this one is
   * raised by a sweep that asks the resulting rows instead. A sale that
   * completes with an empty ledger through an exit nobody enumerated is
   * invisible to every path-based alert — which is precisely how the €0.99 sale
   * of 2026-07-28 went unnoticed for thirteen days.
   *
   * Nothing self-heals it: with no row there is no `hold_reason` and no charge
   * id, so `listPayableHolds` cannot see it and `retry-pending-payouts` has
   * nothing to drain. Reported, never repaired — re-driving transfers from a
   * cron is what T-265 refuses to do.
   *
   * ⚠️ Its OWN kind, not `needs-reconciliation` (T-264). Sharing one would let
   * this collapse into the clawback path's issue and let whichever fires first
   * silence the other for the email window.
   */
  | 'order-without-payouts'
  /**
   * The order-payout reconciliation sweep itself failed every retry (T-255).
   *
   * ⚠️ This is an alert about a **missing check**, not about an order. The sweep
   * is the only thing that sees a charged order which opened no payout row at
   * all, and every query on its path throws; a throw inside `step.run` fails the
   * Inngest RUN, which shows up in that dashboard and nowhere else. So a
   * statement timeout on the window scan would silence T-255 permanently while
   * the app looked healthy — the T-125 shape, where production quietly ran 5 of
   * 13 registered functions.
   *
   * Its OWN kind, per the rule above: the remediation is "go fix the sweep",
   * which shares nothing with "go reconcile this charge".
   */
  | 'payout-reconciliation-failed';

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
      tags: { subsystem: subsystemFor(kind), incident: kind },
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
 * Sentry tag. Every kind but one is a payout-path failure; the delivery email is
 * a different subsystem and a wrong tag is worse than a coarse one.
 */
function subsystemFor(kind: MoneyIncidentKind): string {
  return kind === 'purchase-email-not-delivered' ? 'delivery' : 'payouts';
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
  // Shared with the readiness probe (T-266) so the check and the sender can
  // never disagree about what "configured" means. `''` is a configured-but-empty
  // value (see env.mjs) and means "not set".
  const to = resolveMoneyAlertRecipient(env.MONEY_ALERT_EMAIL);
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
