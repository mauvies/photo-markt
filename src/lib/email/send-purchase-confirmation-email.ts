import { BUYER_FOOTNOTE, escapeHtml, renderTransactionalEmail } from '@/lib/email/layout';
import { sendEmail } from '@/lib/email/send-email';
import { withdrawalConsentEmailBlock } from '@/lib/email/withdrawal-consent-block';
import type { WithdrawalConsentRecord } from '@/lib/withdrawal-consent';

/**
 * Purchase confirmation for a SIGNED-IN buyer (T-228).
 *
 * Until this shipped only guests received an email (`sendGuestPurchaseEmail`);
 * a signed-in buyer got no confirmation at all, so the art. 8.7 obligation to
 * confirm the contract on a durable medium was unmet for half of all purchases
 * — and there was nowhere to restate the art. 16(m) consent for them.
 *
 * Deliberately says something different from the guest template rather than
 * sharing one parameterised message: an account holder has a permanent library,
 * not a 30-day download token. Only the chrome is shared
 * (`renderTransactionalEmail`), plus the consent block, whose wording must not
 * drift between the two.
 *
 * English-only: the webhook has no locale for the buyer, exactly as with the
 * guest email. Localizing both is a separate change.
 *
 * Sends through `sendEmail`, so a Resend rejection throws instead of resolving
 * as a success the caller cannot see (T-253).
 */
export async function sendPurchaseConfirmationEmail({
  to,
  photoCount,
  eventNames,
  baseUrl,
  withdrawalConsent,
}: {
  to: string;
  photoCount: number;
  eventNames: string[];
  baseUrl: string;
  withdrawalConsent?: WithdrawalConsentRecord | null;
}): Promise<void> {
  const ordersUrl = escapeHtml(`${baseUrl}/dashboard/talent/orders`);
  // Photographer-typed, so escaped like any other untrusted interpolation.
  const eventsText = eventNames.length > 0 ? escapeHtml(eventNames.join(', ')) : 'your event';
  const photoLabel = photoCount === 1 ? 'photo' : 'photos';

  await sendEmail({
    to,
    kind: 'purchase confirmation',
    subject: 'Your Photo Markt order is confirmed',
    html: renderTransactionalEmail(
      `
          <!-- Body -->
          <tr>
            <td style="padding: 32px 40px;">
              <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 600; color: #111827;">
                Your order is confirmed 🎉
              </h2>
              <p style="margin: 0 0 24px; color: #6b7280; line-height: 1.6;">
                You purchased ${photoCount} ${photoLabel} from <strong>${eventsText}</strong>.
                They are in your library now — download the full-resolution files any time.
              </p>

              <!-- CTA Button -->
              <a href="${ordersUrl}"
                style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
                View your photos
              </a>

              <p style="margin: 20px 0 0; color: #9ca3af; font-size: 13px;">
                Your purchased photos stay in your account — no expiry, re-download whenever you like.
              </p>
            </td>
          </tr>
${withdrawalConsentEmailBlock(withdrawalConsent)}`,
      BUYER_FOOTNOTE,
    ),
  });
}
