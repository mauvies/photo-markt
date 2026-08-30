import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyWebhookResponse,
  compareInngest,
  compareMigrations,
  countRegisteredFunctions,
  formatReport,
  hasFailures,
  hashSql,
  type LocalMigration,
  normalizeSql,
  summarizeInngest,
  summarizeMigrations,
  summarizeWebhooks,
} from '../../../scripts/ops-drift';

function local(version: string, sql: string): LocalMigration {
  return { version, filename: `${version}_thing.sql`, sql };
}

// T-256: the four incidents this script exists to catch are, in order, a dead
// Stripe webhook (T-192), a partially synced Inngest app (T-125), a migration
// that was never applied, and a migration that was applied and then edited
// (T-204). Each check below names the one it pins.
describe('normalizeSql', () => {
  it('ignores the whitespace the CLI drops between statements', () => {
    // The tracking table stores an ARRAY of statements, so rejoining it never
    // reproduces the file byte for byte: `$$;create` vs `$$;\n\ncreate`.
    expect(normalizeSql('create table a();\n\ncreate table b();')).toBe(
      normalizeSql('create table a();create table b()'),
    );
  });

  it('does not collapse two genuinely different statements', () => {
    expect(hashSql('alter table t add column a int;')).not.toBe(
      hashSql('alter table t add column b int;'),
    );
  });

  it('normalizes semicolons inside function bodies identically on both sides', () => {
    const body = 'create function f() returns int language plpgsql as $$ begin return 1; end; $$;';
    expect(hashSql(body)).toBe(hashSql(body.replace(/\s+/g, '\n')));
  });
});

/**
 * The normalization is only worth anything if it does not cry wolf, so it is
 * asserted against the WHOLE real corpus rather than a handful of samples: every
 * migration must survive a round trip through the statement-array shape the
 * Supabase CLI records. A false mismatch here would train everyone to ignore the
 * one check that catches T-204.
 */
describe('normalizeSql against every migration in the repo', () => {
  it('round-trips all of them through the statement-array shape', () => {
    const dir = 'supabase/migrations';
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(50);

    const mismatched = files.filter((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      // How the CLI stores it: split on top-level `;`, whitespace between
      // statements discarded.
      const asStatements = sql
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      return hashSql(asStatements.join(';')) !== hashSql(sql);
    });

    expect(mismatched).toEqual([]);
  });
});

describe('compareMigrations', () => {
  it('flags a migration that was never applied (the Actions-minutes incident)', () => {
    const findings = compareMigrations([local('20260101000000', 'select 1;')], []);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe('missing');
    expect(summarizeMigrations(findings).outcome).toBe('fail');
  });

  it('flags a migration edited AFTER it was applied (T-204)', () => {
    const findings = compareMigrations(
      [local('20260101000000', 'alter table t add column a int;\nalter table t add column b int;')],
      [{ version: '20260101000000', statements: ['alter table t add column a int'] }],
    );
    expect(findings[0].status).toBe('hash-mismatch');
    const summary = summarizeMigrations(findings);
    expect(summary.outcome).toBe('fail');
    expect(summary.details[0]).toContain('EDITED AFTER APPLY');
  });

  it('passes an applied migration whose SQL still matches', () => {
    const sql = 'create table a();\n\ncreate table b();';
    const findings = compareMigrations(
      [local('20260101000000', sql)],
      [{ version: '20260101000000', statements: ['create table a()', 'create table b()'] }],
    );
    expect(findings[0].status).toBe('ok');
    expect(summarizeMigrations(findings).outcome).toBe('pass');
  });

  it('reports a row with no recorded SQL as unverifiable, not as a pass', () => {
    // `migrate.yml` inserts `version` alone, so an edit to those files cannot be
    // detected in that environment. A green tick there would be a lie by omission.
    const findings = compareMigrations(
      [local('20260101000000', 'select 1;')],
      [{ version: '20260101000000', statements: null }],
    );
    expect(findings[0].status).toBe('unverifiable');

    const summary = summarizeMigrations(findings);
    expect(summary.outcome).toBe('pass');
    expect(summary.details.join(' ')).toContain('cannot be detected here');
  });

  it('flags SQL applied in an environment that the repo does not have', () => {
    const findings = compareMigrations(
      [],
      [{ version: '20250101000000', statements: ['select 1'] }],
    );
    expect(findings[0].status).toBe('unknown-in-env');
    expect(summarizeMigrations(findings).outcome).toBe('fail');
  });
});

describe('countRegisteredFunctions', () => {
  it('counts the array the Inngest route calls its source of truth', () => {
    expect(
      countRegisteredFunctions(`export const { GET } = serve({
        client: inngest,
        functions: [
          indexPhotoFaces,
          generatePhotoThumbnails,
          retryPendingPayouts,
        ],
      });`),
    ).toBe(3);
  });

  it('matches the real route, so the check cannot drift from it silently', () => {
    const source = readFileSync('src/app/api/inngest/route.ts', 'utf8');
    const declared = source
      .split('\n')
      .filter((line) => /^import \{ \w+ \} from '@\/lib\/inngest\/functions\//.test(line));
    expect(countRegisteredFunctions(source)).toBe(declared.length);
  });

  it('throws rather than guessing when the array cannot be found', () => {
    expect(() => countRegisteredFunctions('export const GET = () => {};')).toThrow(
      /source of truth/,
    );
  });
});

describe('compareInngest', () => {
  it('flags a deployment serving a different number of functions (T-125)', () => {
    const finding = compareInngest(11, { function_count: 14, mode: 'cloud' });
    expect(finding.status).toBe('count-mismatch');
    expect(summarizeInngest(finding).outcome).toBe('fail');
  });

  it('flags a deployment that rejects a correctly signed request', () => {
    const finding = compareInngest(11, { authentication_succeeded: false });
    expect(finding.status).toBe('unauthenticated');
    expect(summarizeInngest(finding).outcome).toBe('fail');
  });

  it('flags a deployed app still in dev mode', () => {
    // It would be talking to a Dev Server that does not exist.
    const finding = compareInngest(11, { function_count: 11, mode: 'dev' });
    expect(finding.status).toBe('wrong-mode');
  });

  it('passes when the deployment agrees with the repo', () => {
    const finding = compareInngest(11, {
      function_count: 11,
      mode: 'cloud',
      authentication_succeeded: true,
    });
    expect(finding.status).toBe('ok');
    expect(summarizeInngest(finding).outcome).toBe('pass');
  });
});

describe('classifyWebhookResponse', () => {
  it('fails a redirect, which is the whole T-192 incident', () => {
    // Stripe does not follow redirects on webhook deliveries: an endpoint
    // registered on the apex 307s to www and EVERY delivery dies, while the site
    // looks perfectly healthy.
    const finding = classifyWebhookResponse(
      'https://photomarkt.com/api/stripe/webhook',
      307,
      'https://www.photomarkt.com/api/stripe/webhook',
    );
    expect(finding.status).toBe('redirects');

    const summary = summarizeWebhooks([finding]);
    expect(summary.outcome).toBe('fail');
    expect(summary.details[0]).toContain('does NOT follow redirects');
  });

  it('PASSES a 400, because an unsigned probe is supposed to be rejected', () => {
    expect(
      classifyWebhookResponse('https://www.photomarkt.com/api/stripe/webhook', 400, null).status,
    ).toBe('ok');
    expect(summarizeWebhooks([classifyWebhookResponse('u', 400, null)]).outcome).toBe('pass');
  });

  it('fails an account with no enabled endpoint at all', () => {
    // Found by running the check: "0/0 answering" was reported as a pass, and an
    // account subscribed to nothing is exactly as dead as one behind a 307.
    const summary = summarizeWebhooks([]);
    expect(summary.outcome).toBe('fail');
    expect(summary.details[0]).toContain('can never run');
  });

  it('fails a 5xx and an endpoint that never answered', () => {
    expect(classifyWebhookResponse('u', 502, null).status).toBe('server-error');
    expect(classifyWebhookResponse('u', null, null).status).toBe('unreachable');
  });
});

describe('formatReport', () => {
  it('exits red when any check failed, and names which', () => {
    const reports = [
      {
        environment: 'production',
        checks: [
          summarizeMigrations(compareMigrations([local('20260101000000', 'select 1;')], [])),
          summarizeInngest(compareInngest(11, { function_count: 11, mode: 'cloud' })),
        ],
      },
    ];
    expect(hasFailures(reports)).toBe(true);
    expect(formatReport(reports)).toContain('DRIFT: production/migrations');
  });

  it('says so plainly when everything agrees', () => {
    const reports = [
      {
        environment: 'staging',
        checks: [summarizeInngest(compareInngest(11, { function_count: 11, mode: 'cloud' }))],
      },
    ];
    expect(hasFailures(reports)).toBe(false);
    expect(formatReport(reports)).toContain('No drift detected.');
  });

  it('does not fail the run for a skipped check', () => {
    const reports = [
      {
        environment: 'staging',
        checks: [
          { name: 'inngest', outcome: 'skip' as const, summary: 'skipped', details: ['no key'] },
        ],
      },
    ];
    expect(hasFailures(reports)).toBe(false);
  });
});
