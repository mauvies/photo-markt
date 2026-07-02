import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs with the repo root as cwd.
const root = process.cwd();
const MIGRATIONS_DIR = resolve(root, 'supabase/migrations');

/**
 * Regression test for the production incident where the `photos` storage
 * bucket was managed by hand in Supabase Studio and never created in
 * production. Every signed-upload-URL mint then inserted into storage.objects
 * with bucket_id = 'photos', violating the objects_bucketId_fkey foreign key
 * (bucket_id -> storage.buckets). Postgres raised 23503, which storage-api
 * surfaces as "The related resource does not exist" — so photo upload never
 * worked in prod.
 *
 * The fix codifies the bucket as a tracked migration. This test guards against
 * anyone dropping that provisioning back to manual Studio setup: the migration
 * set MUST create the `photos` bucket. It fails before the fix (only the
 * `feedback` bucket had an INSERT INTO storage.buckets) and passes after.
 */
describe('photos storage bucket provisioning', () => {
  const allMigrationSql = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n')
    .toLowerCase();

  it('is created by a tracked migration, not manual Studio setup', () => {
    // Some migration must INSERT a bucket whose id is 'photos' into
    // storage.buckets. `[^;]*` keeps the match inside a single statement so it
    // can't bridge the `feedback` bucket INSERT to an unrelated `'photos'`
    // string in a later policy migration (which would pass falsely).
    const insertsPhotosBucket = /insert\s+into\s+storage\.buckets[^;]*'photos'/.test(
      allMigrationSql,
    );
    expect(insertsPhotosBucket).toBe(true);
  });
});
