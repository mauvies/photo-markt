/**
 * Drift between what the repo says and what an environment actually runs (T-256).
 *
 * The most expensive failures in this project were not code bugs — they were the
 * repo and production disagreeing with nothing to notice:
 *
 *   1. The Stripe webhook was registered on the apex host, which 307-redirects;
 *      Stripe does not follow redirects, so every delivery was dead (T-192).
 *   2. Production had 5 of 13 Inngest functions synced — thumbnails, bib
 *      detection and the crons silently did not run (T-125).
 *   3. A migration was never applied: `migrate.yml` ran out of Actions minutes,
 *      failed in setup after ~3 s, and the merge took production down.
 *   4. A migration was applied and then EDITED. The file changed, the recorded
 *      row did not, and that column never reached that environment (T-204).
 *
 * All logic worth testing lives here; `check-ops-drift.ts` is the I/O shell that
 * fetches the remote facts and prints the table.
 */

import { createHash } from 'node:crypto';

// ── Migrations ────────────────────────────────────────────────────────────────

/**
 * Compare a migration's SQL across two sources that formatted it differently.
 *
 * The Supabase CLI records each migration as an ARRAY of statements, having
 * dropped whatever whitespace separated them in the file. Reassembling that array
 * with `;` therefore never reproduces the file byte for byte — `$$;create`
 * against `$$;\n\ncreate` — so the comparison has to be whitespace-insensitive on
 * both sides, and specifically around the separator.
 *
 * ⚠️ Verified against the whole corpus rather than assumed: all 93 migrations in
 * `supabase/migrations/` reconstruct EXACTLY under this normalization, including
 * the ones with dollar-quoted function bodies (whose internal semicolons are
 * normalized identically on both sides, so they cannot cause a false mismatch).
 * A drift check that cries wolf is worse than none, so if this ever needs
 * loosening, widen the corpus test first.
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, ';')
    .replace(/;$/, '')
    .trim();
}

/** Stable fingerprint of a migration's SQL, whitespace and layout removed. */
export function hashSql(sql: string): string {
  return createHash('sha256').update(normalizeSql(sql)).digest('hex').slice(0, 12);
}

export interface LocalMigration {
  /** The timestamp prefix, which is what the tracking table keys on. */
  version: string;
  filename: string;
  sql: string;
}

export interface RemoteMigration {
  version: string;
  /**
   * The statements the CLI recorded, or `null` when the row carries none.
   *
   * ⚠️ Null is the NORMAL case for anything applied by `.github/workflows/migrate.yml`:
   * that job inserts `version` alone. Such a row proves the migration ran, and
   * proves nothing about WHICH SQL ran — so incident 4 is undetectable for it,
   * and the report says so instead of showing a green tick.
   */
  statements: string[] | null;
}

export type MigrationStatus =
  /** Same version, same SQL. */
  | 'ok'
  /** In the repo, absent from the environment — incident 3. */
  | 'missing'
  /** Applied, then the file was edited — incident 4. */
  | 'hash-mismatch'
  /** Applied, but the environment recorded no SQL, so an edit cannot be seen. */
  | 'unverifiable'
  /** Recorded in the environment with no file in the repo. */
  | 'unknown-in-env';

export interface MigrationFinding {
  version: string;
  filename: string | null;
  status: MigrationStatus;
  localHash: string | null;
  remoteHash: string | null;
}

export function compareMigrations(
  local: LocalMigration[],
  remote: RemoteMigration[],
): MigrationFinding[] {
  const remoteByVersion = new Map(remote.map((row) => [row.version, row]));
  const findings: MigrationFinding[] = [];

  for (const migration of local) {
    const row = remoteByVersion.get(migration.version);
    const localHash = hashSql(migration.sql);

    if (!row) {
      findings.push({
        version: migration.version,
        filename: migration.filename,
        status: 'missing',
        localHash,
        remoteHash: null,
      });
      continue;
    }

    if (!row.statements || row.statements.length === 0) {
      findings.push({
        version: migration.version,
        filename: migration.filename,
        status: 'unverifiable',
        localHash,
        remoteHash: null,
      });
      continue;
    }

    const remoteHash = hashSql(row.statements.join(';'));
    findings.push({
      version: migration.version,
      filename: migration.filename,
      status: remoteHash === localHash ? 'ok' : 'hash-mismatch',
      localHash,
      remoteHash,
    });
  }

  const localVersions = new Set(local.map((migration) => migration.version));
  for (const row of remote) {
    if (localVersions.has(row.version)) continue;
    findings.push({
      version: row.version,
      filename: null,
      status: 'unknown-in-env',
      localHash: null,
      remoteHash: row.statements ? hashSql(row.statements.join(';')) : null,
    });
  }

  return findings.sort((a, b) => a.version.localeCompare(b.version));
}

/** The statuses that mean "someone must act", as opposed to "worth knowing". */
const FAILING_MIGRATION_STATUSES = new Set<MigrationStatus>([
  'missing',
  'hash-mismatch',
  'unknown-in-env',
]);

export function migrationFindingFails(finding: MigrationFinding): boolean {
  return FAILING_MIGRATION_STATUSES.has(finding.status);
}

// ── Inngest ───────────────────────────────────────────────────────────────────

/**
 * How many functions the repo registers.
 *
 * Read off the `functions: [...]` array in `src/app/api/inngest/route.ts`, which
 * that file's own docblock calls the single source of truth. Deliberately a
 * source read rather than an import: importing the route pulls the whole Next
 * application graph (and its env validation) into an ops script.
 */
export function countRegisteredFunctions(routeSource: string): number {
  const match = routeSource.match(/functions:\s*\[([\s\S]*?)\]/);
  if (!match) {
    throw new Error(
      'Could not find the `functions: [...]` array in the Inngest route — the drift check reads it as the source of truth.',
    );
  }

  return match[1]
    .split(',')
    .map((entry) => entry.replace(/\/\/.*$/gm, '').trim())
    .filter((entry) => entry.length > 0).length;
}

/** The shape the Inngest SDK answers a signed introspection GET with. */
export interface InngestIntrospection {
  function_count?: number;
  authentication_succeeded?: boolean | null;
  mode?: string;
  has_event_key?: boolean;
  has_signing_key?: boolean;
}

export type InngestStatus = 'ok' | 'count-mismatch' | 'unauthenticated' | 'wrong-mode';

export interface InngestFinding {
  status: InngestStatus;
  repoCount: number;
  deployedCount: number | null;
  mode: string | null;
}

export function compareInngest(
  repoCount: number,
  introspection: InngestIntrospection,
): InngestFinding {
  const deployedCount = introspection.function_count ?? null;
  const mode = introspection.mode ?? null;
  const base = { repoCount, deployedCount, mode };

  // A signature we produced ourselves that the deployment rejects means the
  // signing keys have diverged — which is its own outage: Inngest cannot invoke
  // an endpoint it cannot authenticate against either.
  if (introspection.authentication_succeeded === false) {
    return { ...base, status: 'unauthenticated' };
  }
  // `dev` in a deployed environment means the app is talking to a Dev Server that
  // does not exist, so nothing it registers is reachable.
  if (mode && mode !== 'cloud') return { ...base, status: 'wrong-mode' };
  if (deployedCount !== repoCount) return { ...base, status: 'count-mismatch' };
  return { ...base, status: 'ok' };
}

// ── Stripe webhook endpoints ──────────────────────────────────────────────────

export type WebhookStatus = 'ok' | 'redirects' | 'server-error' | 'unreachable';

export interface WebhookFinding {
  url: string;
  httpStatus: number | null;
  status: WebhookStatus;
  /** Where a redirect points, which is the actionable half of the T-192 finding. */
  location: string | null;
}

/**
 * Classify what a configured Stripe endpoint answered.
 *
 * ⚠️ **A 4xx is a PASS here, and that is the point.** The webhook rejects an
 * unsigned probe with 400, which proves it is reachable and answering. What must
 * never happen is a 3xx: Stripe does not follow redirects on webhook deliveries,
 * so a registered apex URL that 307s to `www` fails every single delivery while
 * the site itself looks perfectly healthy (T-192).
 */
export function classifyWebhookResponse(
  url: string,
  httpStatus: number | null,
  location: string | null,
): WebhookFinding {
  if (httpStatus === null) return { url, httpStatus, status: 'unreachable', location };
  if (httpStatus >= 300 && httpStatus < 400) {
    return { url, httpStatus, status: 'redirects', location };
  }
  if (httpStatus >= 500) return { url, httpStatus, status: 'server-error', location };
  return { url, httpStatus, status: 'ok', location };
}

// ── Report ────────────────────────────────────────────────────────────────────

export type CheckOutcome = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  outcome: CheckOutcome;
  /** One line for the table. */
  summary: string;
  /** Indented under the row: the rows that made it fail, or what was skipped. */
  details: string[];
}

export interface EnvironmentReport {
  environment: string;
  checks: CheckResult[];
}

export function summarizeMigrations(findings: MigrationFinding[]): CheckResult {
  const failing = findings.filter(migrationFindingFails);
  const unverifiable = findings.filter((finding) => finding.status === 'unverifiable');
  const details: string[] = [];

  for (const finding of failing) {
    if (finding.status === 'missing') {
      details.push(`${finding.version} MISSING — in the repo, never applied here`);
    } else if (finding.status === 'hash-mismatch') {
      details.push(
        `${finding.version} EDITED AFTER APPLY — repo ${finding.localHash} vs applied ${finding.remoteHash}`,
      );
    } else {
      details.push(`${finding.version} UNKNOWN — applied here, no such file in the repo`);
    }
  }

  if (unverifiable.length > 0) {
    // Not a failure and not a pass: the rows exist, so nothing is missing, but
    // `migrate.yml` records only `version`, so an edited file cannot be detected
    // for them. Saying "ok" would be a lie by omission.
    details.push(
      `${unverifiable.length} applied without recorded SQL — an edit to those files cannot be detected here (migrate.yml records only \`version\`)`,
    );
  }

  const verified = findings.filter((finding) => finding.status === 'ok').length;
  return {
    name: 'migrations',
    outcome: failing.length > 0 ? 'fail' : 'pass',
    summary:
      failing.length > 0
        ? `${failing.length} problem(s) across ${findings.length} migration(s)`
        : `${verified} verified, ${unverifiable.length} unverifiable, ${findings.length} total`,
    details,
  };
}

export function summarizeInngest(finding: InngestFinding): CheckResult {
  const detail = (message: string) => [message];

  switch (finding.status) {
    case 'ok':
      return {
        name: 'inngest',
        outcome: 'pass',
        summary: `${finding.repoCount} functions, deployment agrees`,
        details: [],
      };
    case 'count-mismatch':
      return {
        name: 'inngest',
        outcome: 'fail',
        summary: `repo registers ${finding.repoCount}, deployment serves ${finding.deployedCount ?? '?'}`,
        details: detail(
          'The deployed build is not this commit. Redeploy, then let Inngest re-sync the app.',
        ),
      };
    case 'unauthenticated':
      return {
        name: 'inngest',
        outcome: 'fail',
        summary: 'the deployment rejected a correctly signed request',
        details: detail(
          'INNGEST_SIGNING_KEY differs between this check and the deployment — Inngest cannot invoke it either.',
        ),
      };
    default:
      return {
        name: 'inngest',
        outcome: 'fail',
        summary: `serving in '${finding.mode ?? 'unknown'}' mode, not 'cloud'`,
        details: detail('A deployed app in dev mode is talking to a Dev Server that is not there.'),
      };
  }
}

export function summarizeWebhooks(findings: WebhookFinding[]): CheckResult {
  const failing = findings.filter((finding) => finding.status !== 'ok');
  const details = failing.map((finding) => {
    if (finding.status === 'redirects') {
      return `${finding.url} → ${finding.httpStatus}${finding.location ? ` to ${finding.location}` : ''} — Stripe does NOT follow redirects; every delivery to this endpoint fails (T-192)`;
    }
    if (finding.status === 'unreachable') return `${finding.url} — no response`;
    return `${finding.url} → ${finding.httpStatus}`;
  });

  // ⚠️ Zero enabled endpoints is a FAILURE, not an empty pass. An account with no
  // webhook endpoint receives no event at all — orders, subscriptions and payouts
  // are as dead as they were behind the 307, and "0/0 answering" would be the
  // greenest possible way to say so.
  if (findings.length === 0) {
    return {
      name: 'stripe-webhook',
      outcome: 'fail',
      summary: 'no enabled endpoint configured',
      details: [
        'Nothing is subscribed to Stripe events here, so the webhook handler in this repo can never run.',
      ],
    };
  }

  return {
    name: 'stripe-webhook',
    outcome: failing.length > 0 ? 'fail' : 'pass',
    summary: `${findings.length - failing.length}/${findings.length} endpoint(s) answering`,
    details,
  };
}

export function skipped(name: string, reason: string): CheckResult {
  return { name, outcome: 'skip', summary: 'skipped', details: [reason] };
}

const OUTCOME_MARK: Record<CheckOutcome, string> = { pass: '✓', fail: '✗', skip: '–' };

export function formatReport(reports: EnvironmentReport[]): string {
  const lines: string[] = [];

  for (const report of reports) {
    lines.push('', `## ${report.environment}`, '');
    const width = Math.max(...report.checks.map((check) => check.name.length));
    for (const check of report.checks) {
      lines.push(`  ${OUTCOME_MARK[check.outcome]} ${check.name.padEnd(width)}  ${check.summary}`);
      for (const detail of check.details) lines.push(`      ${detail}`);
    }
  }

  const failed = reports.flatMap((report) =>
    report.checks
      .filter((check) => check.outcome === 'fail')
      .map((check) => `${report.environment}/${check.name}`),
  );
  lines.push('');
  lines.push(failed.length === 0 ? 'No drift detected.' : `DRIFT: ${failed.join(', ')}`);
  return lines.join('\n');
}

export function hasFailures(reports: EnvironmentReport[]): boolean {
  return reports.some((report) => report.checks.some((check) => check.outcome === 'fail'));
}
