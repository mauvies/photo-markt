import { Resend } from 'resend';
import { env } from '@/env.mjs';
import { withdrawalConsentEmailBlock } from '@/lib/email/withdrawal-consent-block';
import type { WithdrawalConsentRecord } from '@/lib/withdrawal-consent';

const resend = new Resend(env.RESEND_API_KEY);

/**
 * Purchase confirmation for a SIGNED-IN buyer (T-228).
 *
 * Until this shipped only guests received an email (`sendGuestPurchaseEmail`);
 * a signed-in buyer got no confirmation at all, so the art. 8.7 obligation to
 * confirm the contract on a durable medium was unmet for half of all purchases
 * — and there was nowhere to restate the art. 16(m) consent for them.
 *
 * Deliberately mirrors the guest template rather than abstracting a shared one:
 * the two say different things (an account holder has a permanent library, not
 * a 30-day download token) and a premature shared layout would have to be torn
 * apart the first time either diverges. The consent block IS shared, because
 * that wording must not drift.
 *
 * English-only: the webhook has no locale for the buyer, exactly as with the
 * guest email. Localizing both is a separate change.
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
  const ordersUrl = `${baseUrl}/dashboard/talent/orders`;
  const eventsText = eventNames.length > 0 ? eventNames.join(', ') : 'your event';
  const photoLabel = photoCount === 1 ? 'photo' : 'photos';

  await resend.emails.send({
    from: 'Photo Markt <noreply@photomarkt.com>',
    to,
    subject: 'Your Photo Markt order is confirmed',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px 24px; border-bottom: 1px solid #f3f4f6;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #111827;">Photo Markt</h1>
            </td>
          </tr>

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
${withdrawalConsentEmailBlock(withdrawalConsent)}
        </table>

        <p style="margin: 20px 0 0; color: #9ca3af; font-size: 12px;">
          You received this email because you purchased photos on Photo Markt.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  });
}
