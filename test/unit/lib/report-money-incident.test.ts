/**
 * Unit tests for `reportMoneyIncident` (T-249).
 *
 * The two properties that matter are both negative ones: it must never throw
 * into the money path it observes, and it must never carry buyer PII. The
 * throttle test pins the third: the email channel is damped so one outage
 * cannot flood the inbox, while console + Sentry stay unthrottled.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above the module body, so everything they
// close over has to be hoisted with them (the repo's `sitemap.test.ts` pattern).
const { captureException, sendMoneyAlertEmail, env } = vi.hoisted(() => ({
  captureException: vi.fn(),
  // Typed args so the throttle test can read back which kind was sent.
  sendMoneyAlertEmail: vi.fn(async (_payload: { to: string; kind: string }) => undefined),
  // `env.mjs` validates at import time; stub it so each case can flip
  // MONEY_ALERT_EMAIL without touching the real schema.
  env: { MONEY_ALERT_EMAIL: undefined as string | undefined },
}));

vi.mock('@sentry/nextjs', () => ({ captureException }));
vi.mock('@/lib/email/send-money-alert', () => ({ sendMoneyAlertEmail }));
vi.mock('@/env.mjs', () => ({ env }));

import { reportMoneyIncident } from '@/lib/observability/report-money-incident';

/**
 * The throttle keeps its state in a module-level variable, which persists across
 * cases in this file. Rather than exporting a reset hook from production code
 * (nothing else in `src/` carries one), each case jumps the clock well past the
 * 60 s window — which is also what the throttle actually reads.
 */
let clock = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  clock += 10 * 60_000;
  vi.setSystemTime(clock);
  env.MONEY_ALERT_EMAIL = undefined;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('reportMoneyIncident', () => {
  it('reports to Sentry with a kind-stable fingerprint', async () => {
    await reportMoneyIncident({
      kind: 'payout-not-recorded',
      message: 'Could not open the payout ledger row.',
      context: { photographerId: 'ph_1', chargeId: 'ch_1' },
      cause: new Error('boom'),
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, options] = captureException.mock.calls[0] as [Error, Record<string, unknown>];
    expect(error).toBeInstanceOf(Error);
    // Fingerprinted on the kind, not the message — messages carry ids, so
    // fingerprinting on them would make every occurrence its own Sentry issue.
    expect(options.fingerprint).toEqual(['money-incident', 'payout-not-recorded']);
    expect(options.tags).toMatchObject({ subsystem: 'payouts', incident: 'payout-not-recorded' });
  });

  it('does not throw when Sentry itself fails', async () => {
    captureException.mockImplementationOnce(() => {
      throw new Error('sentry down');
    });

    await expect(
      reportMoneyIncident({ kind: 'payout-not-recorded', message: 'ledger write failed' }),
    ).resolves.toBeUndefined();
  });

  it('does not throw when the email channel fails', async () => {
    env.MONEY_ALERT_EMAIL = 'ops@example.com';
    sendMoneyAlertEmail.mockRejectedValueOnce(new Error('resend down'));

    await expect(
      reportMoneyIncident({ kind: 'payout-not-recorded', message: 'ledger write failed' }),
    ).resolves.toBeUndefined();
  });

  it('sends no email when MONEY_ALERT_EMAIL is unset, but still reports to Sentry', async () => {
    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'ledger write failed' });

    expect(sendMoneyAlertEmail).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('throttles the email channel but not Sentry', async () => {
    env.MONEY_ALERT_EMAIL = 'ops@example.com';

    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'first' });
    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'second' });
    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'third' });

    // One inbox item for the burst...
    expect(sendMoneyAlertEmail).toHaveBeenCalledTimes(1);
    // ...but every occurrence still lands in Sentry, where the fingerprint
    // groups them into one issue with an accurate count.
    expect(captureException).toHaveBeenCalledTimes(3);
  });

  it('throttles per kind, so one incident does not silence a different one', async () => {
    env.MONEY_ALERT_EMAIL = 'ops@example.com';

    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'no payout row' });
    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'no payout row again' });
    // A different incident entirely — not a duplicate, so it must get through.
    await reportMoneyIncident({ kind: 'dispute-lost', message: 'dispute lost' });

    expect(sendMoneyAlertEmail).toHaveBeenCalledTimes(2);
    expect(sendMoneyAlertEmail.mock.calls.map(([payload]) => payload.kind)).toEqual([
      'payout-not-recorded',
      'dispute-lost',
    ]);
  });

  it('releases the throttle when the send fails, so the next incident still alerts', async () => {
    env.MONEY_ALERT_EMAIL = 'ops@example.com';
    sendMoneyAlertEmail.mockRejectedValueOnce(new Error('resend down'));

    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'first' });
    // Same window, same kind: without the release a transient Resend blip would
    // suppress the retry and the incident would go unreported after all.
    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'second' });

    expect(sendMoneyAlertEmail).toHaveBeenCalledTimes(2);
  });

  it('releases the email throttle once the window has passed', async () => {
    env.MONEY_ALERT_EMAIL = 'ops@example.com';

    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'first' });
    expect(sendMoneyAlertEmail).toHaveBeenCalledTimes(1);

    // Without this the throttle would be indistinguishable from "alert once and
    // then go quiet forever" — which is the failure mode this ticket is about.
    vi.setSystemTime(clock + 61_000);
    await reportMoneyIncident({ kind: 'payout-not-recorded', message: 'much later' });
    expect(sendMoneyAlertEmail).toHaveBeenCalledTimes(2);
  });

  it('sends the identifiers it was given to the email channel', async () => {
    env.MONEY_ALERT_EMAIL = 'ops@example.com';

    await reportMoneyIncident({
      kind: 'payout-not-recorded',
      message: 'ledger write failed',
      context: { photographerId: 'ph_1', chargeId: 'ch_1', netCents: 91 },
    });

    expect(sendMoneyAlertEmail).toHaveBeenCalledWith({
      to: 'ops@example.com',
      kind: 'payout-not-recorded',
      message: 'ledger write failed',
      context: { photographerId: 'ph_1', chargeId: 'ch_1', netCents: 91 },
    });
  });
});
