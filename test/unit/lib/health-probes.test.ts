import { describe, expect, it } from 'vitest';
import {
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
