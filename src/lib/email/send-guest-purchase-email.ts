import { Resend } from 'resend';
import { env } from '@/env.mjs';

const resend = new Resend(env.RESEND_API_KEY);

export async function sendGuestPurchaseEmail({
  to,
  downloadToken,
  photoCount,
  eventNames,
  baseUrl,
}: {
  to: string;
  downloadToken: string;
  photoCount: number;
  eventNames: string[];
  baseUrl: string;
}): Promise<void> {
  const downloadUrl = `${baseUrl}/download/${downloadToken}`;
  const signupUrl = `${baseUrl}/signup?token=${downloadToken}`;

  const eventsText = eventNames.length > 0 ? eventNames.join(', ') : 'your event';

  const photoLabel = photoCount === 1 ? 'photo' : 'photos';

  await resend.emails.send({
    from: 'Photo Markt <noreply@photomarkt.com>',
    to,
    subject: 'Your Photo Markt photos are ready to download!',
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
          </tr>
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
