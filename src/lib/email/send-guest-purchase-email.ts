import { BUYER_FOOTNOTE, escapeHtml, renderTransactionalEmail } from '@/lib/email/layout';
import { sendEmail } from '@/lib/email/send-email';
import { withdrawalConsentEmailBlock } from '@/lib/email/withdrawal-consent-block';
import type { WithdrawalConsentRecord } from '@/lib/withdrawal-consent';

/**
 * Delivery of the purchase for a GUEST buyer.
 *
 * ⚠️ This email is the product, not a receipt: a guest has no account, so the
 * download link it carries is the only way they ever reach the photos they paid
 * for. It therefore goes through `sendEmail`, which turns Resend's resolved
 * `{ error }` into a throw — before T-253 a rejected message resolved happily
 * and the buyer was left with nothing, silently (the webhook's `catch` never
 * fired and the log line said the order had been created).
 */
export async function sendGuestPurchaseEmail({
  to,
  downloadToken,
  photoCount,
  eventNames,
  baseUrl,
  withdrawalConsent,
}: {
  to: string;
  downloadToken: string;
  photoCount: number;
  eventNames: string[];
  baseUrl: string;
  /** T-228 / art. 8.7 — absent ⇒ the consent block is omitted entirely. */
  withdrawalConsent?: WithdrawalConsentRecord | null;
}): Promise<void> {
  const downloadUrl = escapeHtml(`${baseUrl}/download/${downloadToken}`);
  const signupUrl = escapeHtml(`${baseUrl}/signup?token=${downloadToken}`);

  // Event names are typed by the photographer, so they are escaped like any
  // other untrusted value interpolated into this hand-written HTML.
  const eventsText = eventNames.length > 0 ? escapeHtml(eventNames.join(', ')) : 'your event';

  const photoLabel = photoCount === 1 ? 'photo' : 'photos';

  await sendEmail({
    to,
    kind: 'guest purchase',
    subject: 'Your Photo Markt photos are ready to download!',
    html: renderTransactionalEmail(
      `
          <!-- Body -->
          <tr>
            <td style="padding: 32px 40px;">
              <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 600; color: #111827;">
                Your ${photoLabel} ${photoCount === 1 ? 'is' : 'are'} ready! 🎉
              </h2>
              <p style="margin: 0 0 24px; color: #6b7280; line-height: 1.6;">
                You purchased ${photoCount} ${photoLabel} from <strong>${eventsText}</strong>.
                Click the button below to view and download your high-resolution images.
              </p>

              <!-- CTA Button -->
              <a href="${downloadUrl}"
                style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
                View &amp; Download Photos
              </a>

              <p style="margin: 20px 0 0; color: #9ca3af; font-size: 13px;">
                This link is valid for 30 days. Download your photos soon!
              </p>
            </td>
          </tr>

${withdrawalConsentEmailBlock(withdrawalConsent)}

          <!-- Upsell -->
          <tr>
            <td style="padding: 24px 40px 32px; background: #f9fafb; border-top: 1px solid #f3f4f6;">
              <p style="margin: 0 0 8px; font-weight: 600; color: #374151; font-size: 14px;">
                Save your photos forever — create a free account
              </p>
              <p style="margin: 0 0 16px; color: #6b7280; font-size: 13px; line-height: 1.5;">
                With a Photo Markt account your purchased photos live in your personal library permanently —
                no expiry, easy re-download, and AI-powered search to find yourself in new events.
              </p>
              <a href="${signupUrl}"
                style="display: inline-block; background: #ffffff; color: #111827; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: 600; font-size: 13px; border: 1px solid #d1d5db;">
                Create your free account →
              </a>
            </td>
          </tr>`,
      BUYER_FOOTNOTE,
    ),
  });
}
