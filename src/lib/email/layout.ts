/**
 * The HTML chrome shared by the app's emails (T-253).
 *
 * Only the **skeleton** lives here — doctype, head, body styling, and (for the
 * buyer-facing templates) the card, its header and its footnote. The message
 * itself stays in each sender: the guest email and the signed-in confirmation
 * deliberately say different things (a 30-day download token vs. a permanent
 * library), and folding those into one parameterised template would have to be
 * undone the first time either diverges. What was worth removing is the copy —
 * the same doctype/table/header block was written out four times.
 */

/** Footnote for the two buyer receipts — shared so the wording can't drift. */
export const BUYER_FOOTNOTE =
  'You received this email because you purchased photos on Photo Markt.';

/**
 * Wrapper for a message to a person: centred 560px card on a grey page, with
 * the Photo Markt header and a "why you got this" footnote.
 *
 * `rowsHtml` is the caller's `<tr>` rows, inserted straight after the header row
 * of the card table. `footnote` is required rather than defaulted (T-250): the
 * buyer text — "because you purchased photos" — is plainly wrong on an email to
 * a photographer about their own sale, and a default is exactly how that ships
 * unnoticed.
 */
export function renderTransactionalEmail(rowsHtml: string, footnote: string): string {
  return `
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
${rowsHtml}
        </table>

        <p style="margin: 20px 0 0; color: #9ca3af; font-size: 12px;">
          ${footnote}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
}

/**
 * Operational wrapper: no branding, no card — these go to us, not to a buyer,
 * and are read in a hurry.
 */
export function renderOpsAlertEmail(bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827;">
${bodyHtml}
</body>
</html>
    `;
}

/**
 * Escape a value interpolated into any of these hand-assembled templates.
 *
 * Needed on both sides: the ops alerts carry error text and ids we do not
 * control, and the buyer templates carry **event names**, which a photographer
 * types. Neither is markup.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
