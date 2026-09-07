import { describe, expect, it } from 'vitest';
import {
  assessMoneyAlertChannels,
  isSentryConfigured,
  resolveMoneyAlertRecipient,
} from '@/lib/observability/money-alert-channels';

/**
 * T-266. The property under test is not "is the env var set" but "would a money
 * incident still reach a human". Both channels are optional on purpose, so the
 * only thing standing between a lost sale and a silent `console.error` is this
 * decision plus the readiness probe that surfaces it.
 */
describe('resolveMoneyAlertRecipient', () => {
  it('treats an empty or whitespace value as not configured', () => {
    // `env.mjs` accepts `''` deliberately — staging a variable empty must not
    // 500 every route — so `''` reaching a sender means "nobody".
    expect(resolveMoneyAlertRecipient('')).toBeNull();
    expect(resolveMoneyAlertRecipient('   ')).toBeNull();
    expect(resolveMoneyAlertRecipient(undefined)).toBeNull();
    expect(resolveMoneyAlertRecipient(null)).toBeNull();
  });

  it('returns the trimmed recipient when one is configured', () => {
    expect(resolveMoneyAlertRecipient(' ops@example.com ')).toBe('ops@example.com');
  });
});

describe('isSentryConfigured', () => {
  it('is false for an empty DSN — the SDK is inert with one', () => {
    expect(isSentryConfigured('')).toBe(false);
    expect(isSentryConfigured('  ')).toBe(false);
    expect(isSentryConfigured(undefined)).toBe(false);
  });

  it('is true for a real DSN', () => {
    expect(isSentryConfigured('https://abc@o1.ingest.sentry.io/2')).toBe(true);
  });
});

describe('assessMoneyAlertChannels (T-266)', () => {
  const inProduction = { vercelEnv: 'production' } as const;

  it('is live when either channel alone is configured', () => {
    // One channel is enough: the two are independent, and demanding both would
    // report a problem where none exists.
    expect(
      assessMoneyAlertChannels({
        sentryDsn: 'https://x@o1.ingest.sentry.io/2',
        alertEmail: '',
        ...inProduction,
      }),
    ).toBe('live');
    expect(
      assessMoneyAlertChannels({ sentryDsn: '', alertEmail: 'ops@example.com', ...inProduction }),
    ).toBe('live');
  });

  it('flags production with NEITHER channel configured', () => {
    expect(assessMoneyAlertChannels({ sentryDsn: '', alertEmail: '', ...inProduction })).toBe(
      'unconfigured-in-production',
    );
    expect(
      assessMoneyAlertChannels({ sentryDsn: undefined, alertEmail: undefined, ...inProduction }),
    ).toBe('unconfigured-in-production');
  });

  it('stays quiet in dev, test and preview — running without alerting is correct there', () => {
    for (const vercelEnv of ['preview', 'development', undefined, '']) {
      expect(
        assessMoneyAlertChannels({ sentryDsn: '', alertEmail: '', vercelEnv }),
        `${String(vercelEnv)} must not raise`,
      ).toBe('unconfigured');
    }
  });

  it('never keys production off NODE_ENV', () => {
    // `NODE_ENV` is 'production' for every preview deploy AND for a local
    // `pnpm build`, so keying on it would fail the check exactly where having
    // no ops alerting is the right state. Passing it as the env must not raise.
    expect(
      assessMoneyAlertChannels({ sentryDsn: '', alertEmail: '', vercelEnv: 'preview' }),
    ).not.toBe('unconfigured-in-production');
  });
});
