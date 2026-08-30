/**
 * Does each environment actually run what the repo says? (T-256)
 *
 *   pnpm ops:drift
 *
 * Three checks per environment — migrations, Inngest, the Stripe webhook — one
 * per incident this project has already paid for. See `ops-drift.ts` for the
 * incidents and `ops-drift-environments.ts` for where each environment lives.
 *
 * ⚠️ **READ-ONLY.** It applies no migration, re-syncs no app and reconfigures
 * nothing. It reports, and exits non-zero when something needs a human.
 *
 * Credentials (each optional; a missing one SKIPS its check rather than failing):
 *   SUPABASE_ACCESS_TOKEN                        — a Supabase personal access token
 *   OPS_DRIFT_<ENV>_INNGEST_SIGNING_KEY          — that deployment's signing key
 *   OPS_DRIFT_<ENV>_STRIPE_SECRET_KEY            — that account's secret key
 *   OPS_DRIFT_<ENV>_SITE_URL                     — overrides the pinned host
 *
 * This file is the I/O shell; all logic worth testing lives in `ops-drift.ts`.
 */

import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CheckResult,
  classifyWebhookResponse,
  compareInngest,
  compareMigrations,
  countRegisteredFunctions,
  type EnvironmentReport,
  formatReport,
  hasFailures,
  type InngestIntrospection,
  type LocalMigration,
  type RemoteMigration,
  skipped,
  summarizeInngest,
  summarizeMigrations,
  summarizeWebhooks,
  type WebhookFinding,
} from './ops-drift';
import { OPS_ENVIRONMENTS, type OpsEnvironment } from './ops-drift-environments';

const MIGRATIONS_DIR = 'supabase/migrations';
const INNGEST_ROUTE = 'src/app/api/inngest/route.ts';
/** Long enough for a cold serverless start, short enough to fail a hung host. */
const PROBE_TIMEOUT_MS = 15_000;

function readLocalMigrations(): LocalMigration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith('.sql'))
    .sort()
    .map((filename) => ({
      version: filename.split('_')[0],
      filename,
      sql: readFileSync(join(MIGRATIONS_DIR, filename), 'utf8'),
    }));
}

/**
 * Run one read-only query through the Supabase Management API.
 *
 * The tracking table is asked for `statements` defensively: `migrate.yml` creates
 * it with `create table if not exists ... (version text primary key)`, so an
 * environment where that job ran first genuinely has no such column, and the
 * query must degrade rather than error.
 */
async function fetchRemoteMigrations(
  projectRef: string,
  token: string,
): Promise<RemoteMigration[]> {
  const query = `
    select
      version,
      case
        when exists (
          select 1 from information_schema.columns
          where table_schema = 'supabase_migrations'
            and table_name = 'schema_migrations'
            and column_name = 'statements'
        )
        then to_jsonb(m)->'statements'
        else 'null'::jsonb
      end as statements
    from supabase_migrations.schema_migrations m
    order by version;
  `;

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    },
  );

  if (!response.ok) {
    // Surface the body: it carries the reason (bad token, wrong ref, project
    // paused) and holds no secret. Degrading to "no rows" would report every
    // migration as missing — a false red is as corrosive as a false green.
    throw new Error(
      `Supabase query API returned ${response.status} ${response.statusText}: ${await response.text()}`,
    );
  }

  // ⚠️ Defensive about the envelope, and THROWING when it is unrecognized. If the
  // Management API ever wraps rows differently, an optimistic parse would yield
  // zero rows and report every migration as never applied — a false red that
  // looks exactly like the incident this check exists to find. Failing loudly is
  // the only safe direction.
  const body: unknown = await response.json();
  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as { result?: unknown }).result)
      ? (body as { result: unknown[] }).result
      : Array.isArray((body as { data?: unknown }).data)
        ? (body as { data: unknown[] }).data
        : null;

  if (!rows) {
    throw new Error(
      `Unrecognized response shape from the Supabase query API: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }

  return (rows as Array<{ version: string; statements: string[] | null }>).map((row) => ({
    version: row.version,
    statements: row.statements ?? null,
  }));
}

/**
 * Ask a deployment what it serves, the way Inngest itself would.
 *
 * The SDK answers an unsigned GET with 401 in cloud mode, so the probe signs the
 * request: `t=<unix>&s=<hmac-sha256(body + timestamp)>` keyed on the signing key
 * with its `signkey-<env>-` prefix stripped. The body is empty for a GET, so the
 * concatenation order cannot matter here.
 */
async function fetchInngestIntrospection(
  siteUrl: string,
  signingKey: string,
): Promise<InngestIntrospection> {
  const key = signingKey.replace(/^signkey-[a-z]+-/, '');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', key).update('').update(timestamp).digest('hex');

  const response = await fetch(new URL('/api/inngest', siteUrl), {
    headers: { 'X-Inngest-Signature': `t=${timestamp}&s=${signature}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  if (response.status === 401) return { authentication_succeeded: false };
  if (!response.ok) {
    throw new Error(`Inngest introspection returned ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as InngestIntrospection;
}

interface StripeEndpoint {
  url: string;
  status: string;
}

async function fetchStripeEndpoints(secretKey: string): Promise<StripeEndpoint[]> {
  const response = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100', {
    headers: { Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Stripe webhook_endpoints returned ${response.status}: ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { data?: StripeEndpoint[] };
  return (body.data ?? []).filter((endpoint) => endpoint.status === 'enabled');
}

/**
 * Probe one configured endpoint, without following the redirect that is the
 * whole point of the check.
 *
 * The POST carries no signature, so the handler answers 400 and writes nothing —
 * the probe cannot create an order, a payout or anything else. `redirect: 'manual'`
 * is what makes a 307 visible instead of being silently followed to the 400 the
 * `www` host would return.
 */
async function probeEndpoint(url: string): Promise<WebhookFinding> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'photo-markt-ops-drift' },
      body: '{}',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return classifyWebhookResponse(url, response.status, response.headers.get('location'));
  } catch {
    return classifyWebhookResponse(url, null, null);
  }
}

/** Turn a thrown check into a red row instead of killing the whole run. */
async function runCheck(name: string, run: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await run();
  } catch (error) {
    return {
      name,
      outcome: 'fail',
      summary: 'the check itself failed',
      details: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function checkEnvironment(
  environment: OpsEnvironment,
  local: LocalMigration[],
  repoFunctionCount: number,
): Promise<EnvironmentReport> {
  const checks: CheckResult[] = [];
  const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN;
  const siteUrl = process.env[environment.siteUrlVar] || environment.siteUrl;
  const signingKey = process.env[environment.inngestSigningKeyVar];
  const stripeKey = process.env[environment.stripeSecretKeyVar];

  checks.push(
    !supabaseToken
      ? skipped('migrations', 'SUPABASE_ACCESS_TOKEN is not set')
      : await runCheck('migrations', async () =>
          summarizeMigrations(
            compareMigrations(
              local,
              await fetchRemoteMigrations(environment.supabaseRef, supabaseToken),
            ),
          ),
        ),
  );

  checks.push(
    !siteUrl
      ? skipped('inngest', `no host for this environment — set ${environment.siteUrlVar}`)
      : !signingKey
        ? skipped('inngest', `${environment.inngestSigningKeyVar} is not set`)
        : await runCheck('inngest', async () =>
            summarizeInngest(
              compareInngest(
                repoFunctionCount,
                await fetchInngestIntrospection(siteUrl, signingKey),
              ),
            ),
          ),
  );

  checks.push(
    !stripeKey
      ? skipped('stripe-webhook', `${environment.stripeSecretKeyVar} is not set`)
      : await runCheck('stripe-webhook', async () => {
          // ⚠️ The mode lives in the key, so this is the one credential that could
          // silently answer for the wrong environment. Refuse rather than report.
          if (!stripeKey.startsWith(environment.stripeKeyPrefix)) {
            throw new Error(
              `${environment.stripeSecretKeyVar} is not a ${environment.stripeKeyPrefix}… key — it would report on the wrong Stripe mode.`,
            );
          }
          const endpoints = await fetchStripeEndpoints(stripeKey);
          return summarizeWebhooks(
            await Promise.all(endpoints.map((endpoint) => probeEndpoint(endpoint.url))),
          );
        }),
  );

  return { environment: environment.name, checks };
}

async function main(): Promise<void> {
  const local = readLocalMigrations();
  const repoFunctionCount = countRegisteredFunctions(readFileSync(INNGEST_ROUTE, 'utf8'));

  console.log(
    `Checking ${OPS_ENVIRONMENTS.length} environment(s) against ${local.length} migration(s) and ${repoFunctionCount} Inngest function(s)…`,
  );

  const reports: EnvironmentReport[] = [];
  for (const environment of OPS_ENVIRONMENTS) {
    reports.push(await checkEnvironment(environment, local, repoFunctionCount));
  }

  console.log(formatReport(reports));
  if (hasFailures(reports)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
