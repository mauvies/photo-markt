import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultProbes,
  type Probe,
  rollUpStatus,
  runProbe,
  runReadinessChecks,
  type ServiceCheck,
} from '@/lib/health/probes';

const probe = (service: string, critical: boolean, run: Probe['run']): Probe => ({
  service,
  critical,
  run,
});

describe('runProbe (T-044)', () => {
  it('reports ok when the probe resolves ok', async () => {
    const check = await runProbe(probe('svc', true, async () => 'ok'));
    expect(check).toMatchObject({ service: 'svc', status: 'ok' });
    expect(check.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports skipped when the probe resolves skipped', async () => {
    expect((await runProbe(probe('svc', false, async () => 'skipped'))).status).toBe('skipped');
  });

  it('reports down (never throws) when the probe rejects', async () => {
    const check = await runProbe(
      probe('svc', true, async () => {
        throw new Error('boom with secret connection string');
      }),
    );
    expect(check.status).toBe('down');
    // The error detail must NOT leak into the check.
    expect(JSON.stringify(check)).not.toContain('secret');
  });

  it('reports down when the probe exceeds the timeout', async () => {
    const slow = probe('svc', true, () => new Promise<'ok'>((r) => setTimeout(() => r('ok'), 200)));
    expect((await runProbe(slow, 20)).status).toBe('down');
  });
});

describe('rollUpStatus (T-044)', () => {
  const checks = (statuses: ServiceCheck['status'][]): ServiceCheck[] =>
    statuses.map((status, i) => ({ service: `s${i}`, status, latencyMs: 1 }));

  it('is down when a critical probe is down', () => {
    const probes = [probe('a', true, async () => 'ok'), probe('b', false, async () => 'ok')];
    expect(rollUpStatus(probes, checks(['down', 'ok']))).toBe('down');
  });

  it('is degraded when only a non-critical probe is down', () => {
    const probes = [probe('a', true, async () => 'ok'), probe('b', false, async () => 'ok')];
    expect(rollUpStatus(probes, checks(['ok', 'down']))).toBe('degraded');
  });

  it('is ok when everything is ok or skipped', () => {
    const probes = [probe('a', true, async () => 'ok'), probe('b', false, async () => 'ok')];
    expect(rollUpStatus(probes, checks(['ok', 'skipped']))).toBe('ok');
  });
});

describe('runReadinessChecks (T-044)', () => {
  it('runs every probe and assembles the report', async () => {
    const report = await runReadinessChecks([
      probe('ok-svc', true, async () => 'ok'),
      probe('down-svc', true, async () => {
        throw new Error('x');
      }),
    ]);
    expect(report.status).toBe('down');
    expect(report.checks.map((c) => c.service)).toEqual(['ok-svc', 'down-svc']);
    expect(report.environment).toBeTruthy();
  });
});

describe('money-alerts probe (T-266)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Neither SENTRY_DSN nor MONEY_ALERT_EMAIL is set in test/setup.ts, so these
  // exercise the real "no channel at all" state rather than a simulated one.
  const moneyAlertsProbe = () => {
    const found = defaultProbes().find((p) => p.service === 'money-alerts');
    if (!found) throw new Error('the money-alerts probe is not registered');
    return found;
  };

  it('is registered as a non-critical probe', () => {
    // Removing it would silently restore the blind spot; marking it critical
    // would report the SITE as down over unconfigured ops alerting.
    expect(moneyAlertsProbe().critical).toBe(false);
  });

  it('stays skipped outside production, so dev and preview report ok overall', async () => {
    const check = await runProbe(moneyAlertsProbe());
    expect(check.status).toBe('skipped');
  });

  it('goes down in production with no channel — and degrades the global status', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const probeUnderTest = moneyAlertsProbe();
    const check = await runProbe(probeUnderTest);
    expect(check.status).toBe('down');

    // The property that makes this worth shipping: the external monitor alerts
    // on any status that is not `ok` (docs/monitoring.md), so `degraded` is
    // enough to page — no need to claim the site itself is down.
    expect(rollUpStatus([probeUnderTest], [check])).toBe('degraded');
  });

  it('stays skipped on a PREVIEW deployment, which is where NODE_ENV would lie', async () => {
    // Preview builds run with NODE_ENV='production'. A check keyed on that
    // would fail every preview for having no ops alerting, which is the correct
    // state there — so this is the case that would break first if the
    // discriminator ever drifted back to NODE_ENV.
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'production');
    expect((await runProbe(moneyAlertsProbe())).status).toBe('skipped');
  });
});
