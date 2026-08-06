import { Resend } from 'resend';
import { env } from '@/env.mjs';
import type { MoneyIncidentKind } from '@/lib/observability/report-money-incident';

const resend = new Resend(env.RESEND_API_KEY);

/**
 * Operational alert for a money incident (T-215) — a dispute opened or lost, a
 * transfer reversal that failed, a payout row a human has to reconcile.
 *
 * Email rather than Sentry alone because these need a decision, not just a record:
 * a lost dispute may leave a photographer's connected account negative, and a
 * failed reversal leaves the platform funding a sale that was taken back. Both are
 * things someone acts on the same day, not next sprint.
 *
 * Best-effort in exactly the same way as the face-search alert: the caller wraps
 * this, a Resend failure never reaches the webhook, and an unset `OPS_ALERT_EMAIL`
 * makes it a no-op (the incident is still in Sentry and in the logs). FROM mirrors
 * the other senders.
 *
 * Deliberately carries ids and amounts only — no buyer email, no name. The
 * recipient is an operator who can look anything else up in Stripe.
 */
export async function sendClawbackAlertEmail({
  kind,
  summary,
  details,
}: {
  kind: MoneyIncidentKind;
  /** One line: what happened, in words. */
  summary: string;
  /** Identifiers and amounts, rendered as a definition list. */
  details: Record<string, string | number | null | undefined>;
}): Promise<void> {
  const to = env.OPS_ALERT_EMAIL;
  if (!to) return;

  const rows = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(
      ([key, value]) =>
        `<tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">${key}</td><td style="padding: 4px 0;"><code>${value}</code></td></tr>`,
    )
    .join('');

  await resend.emails.send({
    from: 'Photo Markt <noreply@photomarkt.com>',
    to,
    subject: `⚠️ Money incident: ${kind}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827;">
  <h2 style="margin: 0 0 12px;">${kind}</h2>
  <p style="margin: 0 0 16px; line-height: 1.6;">${summary}</p>
  <table style="border-collapse: collapse; font-size: 14px;">${rows}</table>
  <p style="margin: 16px 0 0; color: #6b7280; font-size: 13px;">
    Full context is in Sentry under the <code>payouts</code> subsystem, and in the
    <code>payouts</code> table for the charge above.
  </p>
</body>
</html>
    `,
  });
}
