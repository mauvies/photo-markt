import { escapeHtml, renderTransactionalEmail } from '@/lib/email/layout';
import { sendEmail } from '@/lib/email/send-email';

/**
 * Tells a photographer they have sold something and that the money is waiting
 * on their payout account (T-250).
 *
 * T-248 removed the Connect gate from checkout, so a photographer without an
 * active payout account now *does* sell: the buyer is charged and the
 * photographer's net is parked as a `connect_inactive` hold that
 * `retry-pending-payouts` drains the moment they connect. That change was paid
 * for with warnings — the dashboard banner, the event notice, the Earnings
 * alert — and **every one of them is in-app**. The photographer this concerns is
 * by definition the one who has not finished onboarding, which makes them the
 * least likely to be looking at the dashboard. Email is the only channel that
 * reaches them.
 *
 * **No buyer PII.** The photographer is told an amount and given a link; who
 * bought, from what address, and what they bought are all absent by design.
 *
 * **English-only, deliberately.** Every template in this directory is, and
 * unlike the buyer receipts there is no locale to read even if we wanted one:
 * `profiles` stores no language preference. The CTA link carries **no locale
 * segment** on purpose — `src/proxy.ts` redirects a locale-less path using the
 * reader's own cookie and `Accept-Language`, so the page they land on is in
 * their language even though this message is not.
 */
export async function sendHeldSaleEmail({
  to,
  heldAmount,
  payoutSettingsUrl,
}: {
  to: string;
  /** Pre-formatted, e.g. "€4.60" — the caller owns the currency. */
  heldAmount: string;
  payoutSettingsUrl: string;
}): Promise<void> {
  const amount = escapeHtml(heldAmount);
  const url = escapeHtml(payoutSettingsUrl);

  await sendEmail({
    to,
    kind: 'held sale',
    subject: 'You made a sale — connect your payout account to receive it',
    html: renderTransactionalEmail(
      `
          <!-- Body -->
          <tr>
            <td style="padding: 32px 40px;">
              <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 600; color: #111827;">
                You sold a photo 🎉
              </h2>
              <p style="margin: 0 0 12px; color: #6b7280; line-height: 1.6;">
                Someone bought your work. Your earnings so far come to
                <strong>${amount}</strong>, and they are waiting for you.
              </p>
              <p style="margin: 0 0 24px; color: #6b7280; line-height: 1.6;">
                We can't send the money until your payout account is set up. Nothing is lost —
                the amount is held for you and we transfer it automatically as soon as your
                account is ready. Your events keep selling in the meantime.
              </p>

              <!-- CTA Button -->
              <a href="${url}"
                style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
                Set up your payout account
              </a>

              <p style="margin: 20px 0 0; color: #9ca3af; font-size: 13px;">
                It takes a few minutes and is handled by Stripe.
              </p>
            </td>
          </tr>`,
      'You received this email because a sale on Photo Markt is waiting to be paid out to you.',
    ),
  });
}
