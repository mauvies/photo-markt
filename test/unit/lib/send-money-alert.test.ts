/**
 * `sendMoneyAlertEmail` must surface a Resend rejection (T-249).
 *
 * `resend.emails.send` resolves `{ data, error }` — it does NOT throw on an API
 * error. Ignoring that result would let an invalid key, an unverified sender
 * domain or a rate limit resolve "successfully", which would make the one
 * channel whose entire job is to not be silent fail silently.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

import { sendMoneyAlertEmail } from '@/lib/email/send-money-alert';

const incident = {
  to: 'ops@example.com',
  kind: 'payout-not-recorded' as const,
  message: 'Could not open the payout ledger row.',
  context: { photographerId: 'ph_1', chargeId: 'ch_1', netCents: 460 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendMoneyAlertEmail', () => {
  it('throws when Resend answers with an error instead of throwing', async () => {
    send.mockResolvedValueOnce({ data: null, error: { message: 'Invalid `to` field' } });

    await expect(sendMoneyAlertEmail(incident)).rejects.toThrow(/Invalid `to` field/);
  });

  it('resolves when Resend accepts the message', async () => {
    send.mockResolvedValueOnce({ data: { id: 'email_1' }, error: null });

    await expect(sendMoneyAlertEmail(incident)).resolves.toBeUndefined();
  });

  it('renders the identifiers into the body and escapes what it interpolates', async () => {
    send.mockResolvedValueOnce({ data: { id: 'email_1' }, error: null });

    await sendMoneyAlertEmail({
      ...incident,
      message: 'broke <script>alert(1)</script>',
      context: { chargeId: 'ch_1', netCents: 460, payoutId: null },
    });

    const payload = send.mock.calls[0]?.[0] as { html: string; subject: string };
    expect(payload.subject).toContain('payout-not-recorded');
    expect(payload.html).toContain('ch_1');
    expect(payload.html).toContain('460');
    // Null entries are dropped rather than rendered as "null".
    expect(payload.html).not.toContain('payoutId');
    // The body is assembled by hand, so interpolated text must not be markup.
    expect(payload.html).not.toContain('<script>');
    expect(payload.html).toContain('&lt;script&gt;');
  });
});
