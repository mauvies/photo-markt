/**
 * Cron worker: sweep orphaned objects in the `photos` Storage bucket every
 * 30 minutes.
 *
 * An orphan is a Storage object whose path is NOT present in
 * `photos.original_url`. The direct-upload flow decouples the byte-PUT
 * (client → Storage) from the row insert (`attachPhotosToEvent`), so a
 * client crash or network failure between the two leaves bytes without a
 * row. The Cancel button on the upload modal already eagerly calls
 * `discardOrphanedUploads`; this cron is the safety net for cases that
 * never reach the server.
 *
 * The 1-hour age threshold gives in-flight uploads plenty of margin —
 * the worst case is a slow tab finishing its 1-hour-long upload on a
 * weak connection.
 *
 * Why Inngest (not pg_cron): Supabase Free does not include pg_cron, and
 * Inngest is already in the stack with cron triggers on its free plan.
 * No new infra.
 */

import { listStorageObjectsOlderThan } from '@/database/queries/storage';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { inngest } from '../client';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

const ORPHAN_AGE_MS = 60 * 60 * 1000; // 1 hour
/** Max paths to consider in a single tick. Plenty of headroom at current
 *  scale; if the queue ever backs up this is the safety valve. */
const MAX_CANDIDATES_PER_TICK = 1000;
const DELETE_BATCH_SIZE = 100;

export const cleanupOrphanedStorageFiles = inngest.createFunction(
  {
    id: 'cleanup-orphaned-storage-files',
    // The cron is single-threaded by virtue of how Inngest schedules
    // recurring functions, but cap it anyway as defense in depth.
    concurrency: { limit: 5 },
    // 0 and 30 past every hour. Standard cron expression.
    triggers: [{ cron: '0,30 * * * *' }],
  },
  async ({ step }: { step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const candidates = await step.run('list-candidates', async () => {
      return await listStorageObjectsOlderThan(
        adminClient,
        'photos',
        ORPHAN_AGE_MS,
        MAX_CANDIDATES_PER_TICK,
      );
    });

    if (candidates.length === 0) {
      return { deleted: 0, considered: 0 };
    }

    const orphans = await step.run('filter-orphans', async () => {
      const paths = candidates.map((c: { path: string }) => c.path);
      const { data } = await supabaseAdmin
        .from('photos')
        .select('original_url')
        .in('original_url', paths);
      const attached = new Set(
        (data ?? [])
          .map((r: { original_url: string | null }) => r.original_url)
          .filter((p: string | null): p is string => typeof p === 'string'),
      );
      return candidates.filter((c: { path: string }) => !attached.has(c.path));
    });

    if (orphans.length === 0) {
      return { deleted: 0, considered: candidates.length };
    }

    await step.run('delete-orphans', async () => {
      for (let i = 0; i < orphans.length; i += DELETE_BATCH_SIZE) {
        const batch = orphans.slice(i, i + DELETE_BATCH_SIZE).map((o: { path: string }) => o.path);
        const { error } = await supabaseAdmin.storage.from('photos').remove(batch);
        if (error) {
          // Log and continue — partial cleanup beats abandoning the tick.
          console.error('[cleanup-orphaned-storage] batch remove failed', {
            count: batch.length,
            error: error.message,
          });
        }
      }
    });

    return { deleted: orphans.length, considered: candidates.length };
  },
);
