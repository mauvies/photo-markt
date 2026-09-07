/**
 * Readiness probes for external services (T-044). Each probe is a cheap,
 * read-only call that validates the service is reachable AND our credentials
 * are valid. Probes run in parallel, each with a hard timeout.
 *
 * SECURITY: a probe NEVER returns its error detail — connection strings, API
 * responses and stack traces can carry secrets. `runProbe` swallows the error
 * and reports only `{ service, status, latencyMs }`.
 *
 * Server-only: imports the admin Supabase client, Stripe, AWS and Resend.
 */

import { ListCollectionsCommand } from '@aws-sdk/client-rekognition';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/database/supabase-admin';
import { env } from '@/env.mjs';
import { getRekognitionClient } from '@/lib/aws/rekognition-client';
import { assessMoneyAlertChannels } from '@/lib/observability/money-alert-channels';
import { stripe } from '@/lib/stripe/config';

export type CheckStatus = 'ok' | 'down' | 'skipped';
export type ReadinessStatus = 'ok' | 'degraded' | 'down';

export interface ServiceCheck {
  service: string;
  status: CheckStatus;
  latencyMs: number;
}

export interface ReadinessReport {
  status: ReadinessStatus;
  environment: string;
  checks: ServiceCheck[];
}

export interface Probe {
  service: string;
  /** A critical service down flips the global status to `down` (alert);
   * a non-critical one only to `degraded`. */
  critical: boolean;
  /** Resolves `'ok'`/`'skipped'`; rejects/throws on failure → reported `down`. */
  run: () => Promise<CheckStatus>;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('probe-timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Run one probe with a timeout. Never throws; never leaks error detail. */
export async function runProbe(
  probe: Probe,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const status = await withTimeout(probe.run(), timeoutMs);
    return { service: probe.service, status, latencyMs: Date.now() - start };
  } catch {
    return { service: probe.service, status: 'down', latencyMs: Date.now() - start };
  }
}

/** The production probe set. Lazily references clients inside each `run`. */
export function defaultProbes(): Probe[] {
  return [
    {
      service: 'supabase',
      critical: true,
      run: async () => {
        const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
        if (error) throw error;
        return 'ok';
      },
    },
    {
      service: 'stripe',
      critical: true,
      run: async () => {
        await stripe.balance.retrieve();
        return 'ok';
      },
    },
    {
      service: 'aws-rekognition',
      critical: true,
      run: async () => {
        await getRekognitionClient().send(new ListCollectionsCommand({ MaxResults: 1 }));
        return 'ok';
      },
    },
    {
      service: 'resend',
      critical: true,
      run: async () => {
        await new Resend(env.RESEND_API_KEY).domains.list();
        return 'ok';
      },
    },
    {
      // No unsigned health check exists: the worker route validates an Inngest
      // signature in cloud mode and 401s an unsigned GET, so a self-fetch would
      // report a permanent false 'down' in production (and can self-deadlock on
      // single-concurrency instances). Report configured-vs-not from the
      // env-validated keys — the most we can assert without a signed request.
      service: 'inngest',
      critical: false,
      run: async () => (env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY ? 'ok' : 'skipped'),
    },
    {
      // No read API; sending an event would pollute the dashboard. Report
      // configured-vs-not instead.
      service: 'sentry',
      critical: false,
      run: async () => (env.SENTRY_DSN ? 'ok' : 'skipped'),
    },
    {
      // T-266: does a money incident still reach a human? `reportMoneyIncident`
      // has two optional channels, and with both off every T-249/T-253/T-255
      // alert degrades to a console line nobody reads — silently, because
      // nothing else in the app changes. The `sentry` probe above reports one
      // half; only this one asserts the DISJUNCTION, which is the property that
      // actually matters.
      //
      // `critical: false` is deliberate and sufficient: the external monitor
      // alerts on any status that is not `ok` (docs/monitoring.md), so
      // `degraded` already pages. Marking it critical would report the SITE as
      // down because its ops alerting is unconfigured — a false outage, and the
      // fastest way to teach whoever is on call to ignore this endpoint.
      //
      // Off outside Vercel production, where having no ops alerting is correct:
      // that case reports `skipped`, which never moves the global status.
      service: 'money-alerts',
      critical: false,
      run: async () => {
        const verdict = assessMoneyAlertChannels({
          sentryDsn: env.SENTRY_DSN,
          alertEmail: env.MONEY_ALERT_EMAIL,
          vercelEnv: process.env.VERCEL_ENV,
        });
        if (verdict === 'unconfigured-in-production') {
          // `runProbe` turns a rejection into `down` and never surfaces the
          // detail; the message is for a local stack trace only.
          throw new Error('no money-alert channel configured');
        }
        return verdict === 'live' ? 'ok' : 'skipped';
      },
    },
    {
      // The browser key is HTTP-referrer-restricted, so it can't be validated
      // server-side. Always skipped here.
      service: 'google-places',
      critical: false,
      run: async () => 'skipped',
    },
  ];
}

/** Roll up per-service checks into the global readiness status. */
export function rollUpStatus(probes: Probe[], checks: ServiceCheck[]): ReadinessStatus {
  let degraded = false;
  for (let i = 0; i < probes.length; i++) {
    if (checks[i]?.status !== 'down') continue;
    if (probes[i]?.critical) return 'down';
    degraded = true;
  }
  return degraded ? 'degraded' : 'ok';
}

/** Run every probe in parallel and assemble the report. */
export async function runReadinessChecks(
  probes: Probe[] = defaultProbes(),
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const checks = await Promise.all(probes.map((probe) => runProbe(probe, timeoutMs)));
  return {
    status: rollUpStatus(probes, checks),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    checks,
  };
}

export const READINESS_CACHE_TTL_MS = 15_000;
let cached: { report: ReadinessReport; expiresAt: number } | null = null;

/**
 * Cached readiness report — bounds how often the **paid** probes actually run,
 * regardless of caller (admin-dashboard reloads, repeated monitor hits, or a
 * rate-limiter that fails open during a backend outage). At most one probe
 * sweep per TTL across the whole process. The `/ready` route layers its own
 * per-IP rate limit on top for abuse control.
 */
export async function getCachedReadinessReport(): Promise<ReadinessReport> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.report;
  const report = await runReadinessChecks();
  cached = { report, expiresAt: now + READINESS_CACHE_TTL_MS };
  return report;
}
