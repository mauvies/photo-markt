import { escapeHtml, renderOpsAlertEmail } from '@/lib/email/layout';
import { sendEmail } from '@/lib/email/send-email';
import type { MoneyIncidentKind } from '@/lib/observability/report-money-incident';

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
 * contract).
 *
 * Best-effort: `reportMoneyIncident` wraps this in try/catch, so a Resend
 * failure never breaks the webhook it is reporting on — but the failure is
 * thrown (by `sendEmail`) rather than swallowed, so the reporter can log the
 * non-delivery and release its throttle.
 */
export async function sendMoneyAlertEmail({
  to,
  kind,
  message,
  context,
  reason,
}: {
  to: string;
  // Typed against the reporter's union rather than `string`, so a direct caller
  // that bypasses `reportMoneyIncident` (and with it the throttle, the console
  // line and the Sentry fingerprint) is a compile error rather than channel
  // drift discovered later.
  kind: MoneyIncidentKind;
  message: string;
  context?: Record<string, string | number | null | undefined>;
  /** Rendered underlying error, when there was one. */
  reason?: string;
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

  await sendEmail({
    to,
    kind: 'money alert',
    subject: `🚨 Money incident: ${kind}`,
    html: renderOpsAlertEmail(`
  <h2 style="margin: 0 0 12px;">Money incident — <code>${escapeHtml(kind)}</code></h2>
  <p style="margin: 0 0 16px; line-height: 1.6;">${escapeHtml(message)}</p>
  ${
    reason
      ? `<p style="margin: 0 0 16px; line-height: 1.6; color: #b91c1c;"><strong>Reason:</strong> <code>${escapeHtml(reason)}</code></p>`
      : ''
  }
  ${
    rows
      ? `<table style="border-collapse: collapse; font-size: 14px; margin: 0 0 16px;">${rows}</table>`
      : ''
  }
  <p style="margin: 0; color: #6b7280; font-size: 13px;">
    The webhook still returned 200 — this alert does not change the payment flow,
    it only makes the failure visible. ${remediationFor(kind)}
  </p>`),
  });
}

/**
 * What the operator is supposed to do next. Kept per kind rather than generic:
 * an undelivered purchase email is not reconciled against the `payouts` table,
 * and telling someone to look there wastes the minutes that matter.
 */
function remediationFor(kind: MoneyIncidentKind): string {
  if (kind === 'purchase-email-not-delivered') {
    return (
      'The buyer has paid and their order exists — what failed is the delivery ' +
      'email. Look the order up and re-send it before they have to ask.'
    );
  }
  return 'Reconcile against Stripe and the <code>payouts</code> table.';
}
