/**
 * Direct SQL access to the local Supabase database, for tests that need the
 * Postgres catalog rather than the data.
 *
 * Extracted from `test/integration/security/security-definer-rpcs.test.ts`
 * (2026-08-03) when the RLS table inventory (T-227) needed the same mechanism.
 * Both inventories ask the same kind of question — "what does the database
 * actually grant?" — and neither can be answered through supabase-js, which
 * cannot execute arbitrary SQL. There is no `pg` driver in this project either.
 *
 * ⚠️ It runs psql INSIDE the db container rather than on the host: `psql` is not
 * reliably on PATH here (`pnpm db:seed` happens to work only where a local
 * Postgres install exists). The integration suite already requires Docker plus
 * `supabase start`, so the container is guaranteed in local runs and in CI.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Resolved once per worker — the running `supabase_db_<project>` container.
 *
 * Module-level memoisation is safe because `vitest.config.ts` sets
 * `pool: 'forks'` with `fileParallelism: false`, so nothing races it.
 */
let dbContainer: string | null = null;

export async function resolveDbContainer(): Promise<string> {
  if (dbContainer) return dbContainer;
  const { stdout } = await execFileAsync('docker', [
    'ps',
    '--filter',
    'name=supabase_db',
    '--format',
    '{{.Names}}',
  ]);
  const name = stdout.trim().split('\n').filter(Boolean)[0];
  if (!name) {
    throw new Error(
      'No running supabase_db container found. Start the local stack with `pnpm db:start`.',
    );
  }
  dbContainer = name;
  return name;
}

/**
 * Run SQL for its side effect. Used to seed `auth.users` in bulk — the admin API
 * needs one HTTP round-trip per user, which makes a 60-user roster too slow to
 * assert a server-side limit ceiling against.
 */
export async function execSql(sql: string): Promise<void> {
  const container = await resolveDbContainer();
  await execFileAsync('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
}

/**
 * Run a scalar-returning query in the local DB and parse its JSON result.
 *
 * Callers wrap their query in `coalesce(json_agg(row_to_json(t)), '[]')` so a
 * zero-row answer parses as `[]` rather than as an empty string.
 */
export async function queryJson<T>(sql: string): Promise<T> {
  const container = await resolveDbContainer();
  const { stdout } = await execFileAsync('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-tAc',
    sql,
  ]);
  return JSON.parse(stdout.trim() || 'null') as T;
}
