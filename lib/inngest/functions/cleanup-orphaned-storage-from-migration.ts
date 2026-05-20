/**
 * One-shot worker that drains `photos_orphan_storage_pending_cleanup` and
 * deletes the corresponding objects from the `photos` Supabase Storage
 * bucket.
 *
 * Why this exists: the orphan-cleanup migration
 * (`20260520000000_cleanup_orphaned_photos.sql`) deletes orphan `photos`
 * rows from Postgres but cannot reach into Supabase Storage. To avoid
 * leaking ~40 storage objects per affected user, the migration captures
 * each orphan's `original_url` into a queue table; this worker reads the
 * queue and removes the matching files in batches.
 *
 * Lifecycle:
 *   1. Migration enqueues paths (once per deploy).
 *   2. Operator fires `storage.cleanup-orphan-queue` manually from the
 *      Inngest dashboard (or via `inngest.send` from a one-off script).
 *   3. Worker reads up to `BATCH_PER_RUN` rows, removes them from
 *      Storage in 100-path chunks, and clears the queue rows that
 *      succeed.
 *   4. Re-fire until the queue is empty. When the queue drains the run
 *      returns `{ deleted: 0 }` and the operator can stop.
 *
 * Why one-shot + manual trigger (not a cron): this is a single migration
 * fallout, not an ongoing concern. The existing
 * `cleanup-orphaned-storage-files` cron handles the steady-state class
 * (post-direct-upload-refactor orphans). Bolting this onto that cron
 * would couple migration-specific data to a routine job that should stay
 * narrow.
 *
 * Best-effort by design: Storage `remove()` failures are logged but
 * don't block — the operator can re-run and the queue rows for failed
 * paths stay enqueued for the next attempt.
 */

import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { inngest } from '../client';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

/**
 * Max rows pulled per fired run. 500 keeps each invocation comfortably
 * under Inngest's step-output cap and bounds Storage API pressure to
 * 5 × 100-path `remove()` calls per run.
 */
const BATCH_PER_RUN = 500;
const STORAGE_REMOVE_BATCH = 100;

interface QueueRow {
  id: string;
  original_url: string;
}

export const cleanupOrphanedStorageFromMigration = inngest.createFunction(
  {
    id: 'cleanup-orphaned-storage-from-migration',
    retries: 3,
    triggers: [{ event: 'storage.cleanup-orphan-queue' }],
  },
  async ({ step }) => {
    // 1. Load a bounded slice of the queue. Service-role client because
    //    the queue table has RLS-on / zero policies (admin-only).
    const queue = await step.run('load-queue', async () => {
      const { data, error } = await adminClient
        .from('photos_orphan_storage_pending_cleanup')
        .select('id, original_url')
        .limit(BATCH_PER_RUN);
      if (error) {
        throw new Error(`load-queue failed: ${error.message}`);
      }
      return (data ?? []) as QueueRow[];
    });

    if (queue.length === 0) {
      return { deleted: 0, remaining: 0 };
    }

    // 2. Remove from Storage in 100-path chunks. Track successes so we
    //    only clear the queue rows that actually got deleted — failed
    //    paths stay enqueued for a later re-run.
    const succeededIds = new Set<string>();
    const chunks = Math.ceil(queue.length / STORAGE_REMOVE_BATCH);
    for (let i = 0; i < chunks; i += 1) {
      const slice = queue.slice(i * STORAGE_REMOVE_BATCH, (i + 1) * STORAGE_REMOVE_BATCH);
      const paths = slice.map((row) => row.original_url);
      await step.run(`storage-remove-${i}`, async () => {
        const { error } = await supabaseAdmin.storage.from('photos').remove(paths);
        if (error) {
          // Log the message (no buffer / no path list — paths are
          // already in our queue and don't need to be echoed here).
          console.error('[cleanup-orphaned-storage-from-migration] remove failed', {
            chunk: i,
            count: paths.length,
            error: error.message,
          });
          return;
        }
        for (const row of slice) succeededIds.add(row.id);
      });
    }

    // 3. Clear the queue rows we successfully removed. Failed rows stay
    //    for the next manual re-fire.
    if (succeededIds.size > 0) {
      await step.run('clear-queue', async () => {
        const ids = Array.from(succeededIds);
        const { error } = await adminClient
          .from('photos_orphan_storage_pending_cleanup')
          .delete()
          .in('id', ids);
        if (error) {
          console.error('[cleanup-orphaned-storage-from-migration] clear-queue failed', {
            count: ids.length,
            error: error.message,
          });
        }
      });
    }

    // 4. Surface remaining count so the operator can decide whether to
    //    re-fire. A run that returns `remaining: 0` means done.
    const remaining = await step.run('count-remaining', async () => {
      const { count } = await adminClient
        .from('photos_orphan_storage_pending_cleanup')
        .select('id', { count: 'exact', head: true });
      return count ?? 0;
    });

    return { deleted: succeededIds.size, remaining };
  },
);
