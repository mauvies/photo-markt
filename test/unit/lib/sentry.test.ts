import { describe, expect, it } from 'vitest';
import { buildSentryOptions } from '@/lib/observability/sentry';

/**
 * Sentry must be a no-op without a DSN: no transport, no events. These tests
 * lock in that gating so dev / test / preview deploys stay silent, and confirm
 * we never opt into default PII collection.
 */
describe('buildSentryOptions', () => {
  it('is disabled when no DSN is provided', () => {
    const opts = buildSentryOptions(undefined);
    expect(opts.enabled).toBe(false);
    expect(opts.dsn).toBeUndefined();
  });

  it('is disabled for an empty or whitespace-only DSN', () => {
    expect(buildSentryOptions('').enabled).toBe(false);
    expect(buildSentryOptions('   ').enabled).toBe(false);
    expect(buildSentryOptions('   ').dsn).toBeUndefined();
  });

  it('is enabled and carries the trimmed DSN when one is present', () => {
    const opts = buildSentryOptions('  https://abc@o0.ingest.sentry.io/1  ');
    expect(opts.enabled).toBe(true);
    expect(opts.dsn).toBe('https://abc@o0.ingest.sentry.io/1');
  });

  it('passes through the environment and never opts into default PII', () => {
    const opts = buildSentryOptions('https://abc@o0.ingest.sentry.io/1', 'production');
    expect(opts.environment).toBe('production');
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.tracesSampleRate).toBeGreaterThanOrEqual(0);
  });
});
