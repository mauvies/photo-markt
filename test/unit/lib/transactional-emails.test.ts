/**
 * T-253 — every sender must surface a Resend rejection.
 *
 * `resend.emails.send` resolves `{ data, error }`; it does NOT throw on an API
 * error. The three senders that predate `send-money-alert.ts` discarded that
 * result, so an unverified domain, a rate limit or an invalid `to` resolved as a
 * success. For the guest purchase email that is not a missing receipt — a guest
 * has no account, so that message IS the delivery of what they paid for, and the
 * webhook's `catch` never fired to say otherwise.
 *
 * These tests fail against the pre-T-253 senders (they resolved) and pass after.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

import { EMAIL_FROM } from '@/lib/email/send-email';
import { sendFaceSearchAlertEmail } from '@/lib/email/send-face-search-alert';
import { sendGuestPurchaseEmail } from '@/lib/email/send-guest-purchase-email';
import { sendPurchaseConfirmationEmail } from '@/lib/email/send-purchase-confirmation-email';

const guestArgs = {
  to: 'guest@example.com',
  downloadToken: 'tok_123',
  photoCount: 2,
  eventNames: ['Marathon 2026'],
  baseUrl: 'https://photomarkt.test',
};

const confirmationArgs = {
  to: 'buyer@example.com',
  photoCount: 1,
  eventNames: ['Marathon 2026'],
  baseUrl: 'https://photomarkt.test',
};

const alertArgs = { to: 'ops@example.com', currentCalls: 1000, cap: 2000 };

const senders = [
  ['guest purchase', () => sendGuestPurchaseEmail(guestArgs)],
  ['purchase confirmation', () => sendPurchaseConfirmationEmail(confirmationArgs)],
  ['face-search alert', () => sendFaceSearchAlertEmail(alertArgs)],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(senders)('%s email', (_name, sendIt) => {
  it('throws when Resend answers with an error instead of throwing', async () => {
    send.mockResolvedValueOnce({ data: null, error: { message: 'Invalid `to` field' } });

    await expect(sendIt()).rejects.toThrow(/Invalid `to` field/);
  });

  it('resolves when Resend accepts the message', async () => {
    send.mockResolvedValueOnce({ data: { id: 'email_1' }, error: null });

    await expect(sendIt()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    // The FROM is written once now, not copied per template.
    expect(send.mock.calls[0]?.[0]).toMatchObject({ from: EMAIL_FROM });
  });
});

describe('buyer templates', () => {
  it('escapes the photographer-typed event name', async () => {
    send.mockResolvedValueOnce({ data: { id: 'email_1' }, error: null });

    await sendGuestPurchaseEmail({
      ...guestArgs,
      eventNames: ['<script>alert(1)</script> 10K'],
    });

    const { html } = send.mock.calls[0]?.[0] as { html: string };
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('still carries the guest download link — the email IS the delivery', async () => {
    send.mockResolvedValueOnce({ data: { id: 'email_1' }, error: null });

    await sendGuestPurchaseEmail(guestArgs);

    const { html, subject } = send.mock.calls[0]?.[0] as { html: string; subject: string };
    expect(html).toContain('https://photomarkt.test/download/tok_123');
    expect(subject).toContain('ready to download');
  });
});
