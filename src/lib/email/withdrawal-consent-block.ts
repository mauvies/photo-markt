import type { WithdrawalConsentRecord } from '@/lib/withdrawal-consent';

/**
 * Restates the right-of-withdrawal consent inside a purchase confirmation
 * email (T-228).
 *
 * Directive 2011/83/EU art. 8.7 (added by the Omnibus Directive 2019/2161)
 * requires the trader to confirm the contract on a durable medium **including**
 * confirmation of the consumer's prior express consent and acknowledgement
 * under art. 16(m). Ticking the box at checkout is only two of the three
 * conditions; this block is the third.
 *
 * Shared by both purchase emails so the wording cannot drift between the guest
 * and the signed-in buyer. Returns an empty string when there is no consent on
 * record (a session created before the gate shipped) — better to say nothing
 * than to assert a consent we cannot evidence.
 *
 * English-only, like the templates that host it: neither email receives the
 * buyer's locale today. Localizing them is its own change.
 */
export function withdrawalConsentEmailBlock(
  consent: WithdrawalConsentRecord | null | undefined,
): string {
  if (!consent) return '';

  const acceptedOn = new Date(consent.acceptedAt).toUTCString();

  return `
          <tr>
            <td style="padding: 20px 40px; border-top: 1px solid #f3f4f6;">
              <p style="margin: 0 0 6px; font-weight: 600; color: #374151; font-size: 13px;">
                Right of withdrawal
              </p>
              <p style="margin: 0; color: #6b7280; font-size: 12px; line-height: 1.6;">
                At checkout on ${acceptedOn} you expressly asked us to start delivering your
                photos immediately and acknowledged that you therefore lose your right of
                withdrawal once the download is available. This confirms that consent
                (wording version ${consent.version}). Your rights if the files are faulty,
                incomplete or not what you bought are unaffected.
              </p>
            </td>
          </tr>`;
}
