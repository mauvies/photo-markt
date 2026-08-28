import { renderOpsAlertEmail } from '@/lib/email/layout';
import { sendEmail } from '@/lib/email/send-email';

/**
 * Operational alert fired when the global daily face-search counter reaches
 * 50% of its cap (T-034). Lets us hear about abuse — or the need to raise the
 * cap before the circuit breaker trips and blocks real users. Deduped by the
 * caller (atomic claim bucket) so this sends at most once per day-window.
 *
 * Best-effort: the caller wraps this in try/catch so a Resend failure never
 * blocks the search. It must still *throw* on one (T-253) — the caller releases
 * its claim bucket in that catch so a later request retries the alert, and a
 * rejection that resolved as a success would burn the window's single claim and
 * suppress the day's early warning entirely.
 */
export async function sendFaceSearchAlertEmail({
  to,
  currentCalls,
  cap,
}: {
  to: string;
  currentCalls: number;
  cap: number;
}): Promise<void> {
  const pct = Math.round((currentCalls / cap) * 100);

  await sendEmail({
    to,
    kind: 'face-search usage alert',
    subject: `⚠️ Face search at ${pct}% of the daily cap`,
    html: renderOpsAlertEmail(`
  <h2 style="margin: 0 0 12px;">Face search daily usage alert</h2>
  <p style="margin: 0 0 12px; line-height: 1.6;">
    Anonymous face search has used <strong>${currentCalls}</strong> of its
    <strong>${cap}</strong> daily AWS-call budget (${pct}%).
  </p>
  <p style="margin: 0 0 12px; line-height: 1.6;">
    If this is legitimate traffic (e.g. a large event's athletes searching),
    raise <code>FACE_SEARCH_GLOBAL_DAILY_CALLS</code> before the circuit breaker
    trips and blocks real users. If it looks like abuse, the breaker will cap
    the spend automatically once the daily limit is reached.
  </p>
  <p style="margin: 0; color: #6b7280; font-size: 13px;">
    Counter resets at the next UTC day boundary.
  </p>`),
  });
}
