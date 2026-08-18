import { Resend } from 'resend';
import { env } from '@/env.mjs';

const resend = new Resend(env.RESEND_API_KEY);

/**
 * Operational alert for a money incident (T-249).
 *
 * Sentry is the structured record; this is the channel a human actually reads.
 * Both are driven from `reportMoneyIncident`
 * (`src/lib/observability/report-money-incident.ts`) — nothing else should call
 * this directly, or the two channels drift apart.
 *
 * PII: the caller passes identifiers and amounts only. This function renders
 * whatever `context` it is given, so it is the caller's job — not this one's —
 * to keep buyer emails and names out of it (see the `MoneyIncident.context`
 * contract). FROM mirrors the other two senders in this directory.
 *
 * Best-effort: `reportMoneyIncident` wraps this in try/catch, so a Resend
 * failure never breaks the webhook it is reporting on.
 */
export async function sendMoneyAlertEmail({
  to,
  kind,
  message,
  context,
}: {
  to: string;
  kind: string;
  message: string;
  context?: Record<string, string | number | null | undefined>;
}): Promise<void> {
  const rows = Object.entries(context ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([key, value]) =>
        `<tr>
          <td style="padding: 4px 12px 4px 0; color: #6b7280; white-space: nowrap;">${escapeHtml(key)}</td>
          <td style="padding: 4px 0;"><code>${escapeHtml(String(value))}</code></td>
        </tr>`,
    )
    .join('');

  // ⚠️ `resend.emails.send` resolves `{ data, error }` — it does NOT throw on an
  // API error. Ignoring the result would let an invalid key, an unverified
  // sender domain or a rate limit resolve "successfully", so the one channel
  // whose entire job is to not be silent would fail silently. Throw so
  // `reportMoneyIncident` logs the non-delivery and releases its throttle.
  const { error } = await resend.emails.send({
    from: 'Photo Markt <noreply@photomarkt.com>',
    to,
    subject: `🚨 Money incident: ${kind}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827;">
  <h2 style="margin: 0 0 12px;">Money incident — <code>${escapeHtml(kind)}</code></h2>
  <p style="margin: 0 0 16px; line-height: 1.6;">${escapeHtml(message)}</p>
  ${
    rows
      ? `<table style="border-collapse: collapse; font-size: 14px; margin: 0 0 16px;">${rows}</table>`
      : ''
  }
  <p style="margin: 0; color: #6b7280; font-size: 13px;">
    The webhook still returned 200 — this alert does not change the payment flow,
    it only makes the failure visible. Reconcile against Stripe and the
    <code>payouts</code> table.
  </p>
</body>
</html>
    `,
  });

  if (error) {
    throw new Error(`Resend rejected the money alert: ${error.message}`);
  }
}

/**
 * Escape the interpolated values. `message` and `context` carry ids and error
 * text that we do not control, and this HTML is assembled by hand.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
