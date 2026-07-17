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
      // A path is in-use if it backs a photo row OR is a live event's dedicated
      // cover image. Covers have no `photos` row, so without the second check
      // the sweep would delete them (T-055). `deleted_at is null` so a cover
      // left behind by a failed event-delete can still be reclaimed later.
      //
      // T-142: the photos lookup deliberately has NO `deleted_at` filter — a
      // soft-deleted-after-sale photo keeps its `original_url` and its storage
      // must NEVER be swept (the buyer still downloads it). Do not add
      // `.is('deleted_at', null)` here; that would delete a paying buyer's bytes.
      const [photoRows, coverRows] = await Promise.all([
        supabaseAdmin.from('photos').select('original_url').in('original_url', paths),
        supabaseAdmin
          .from('events')
          .select('cover_path')
          .is('deleted_at', null)
          .in('cover_path', paths),
      ]);
      // Fail SAFE: if either in-use lookup errors, delete nothing this tick.
      // A null `data` from a failed query would otherwise be read as "nothing
      // is in use" and could permanently remove live photos or covers. The
      // cron runs again in 30 min, so skipping a tick is harmless.
      if (photoRows.error || coverRows.error) {
        console.error(
          '[cleanup-orphaned-storage] in-use lookup failed; skipping deletion this tick',
          { photoError: photoRows.error?.message, coverError: coverRows.error?.message },
        );
        return [];
      }
      const attached = new Set<string>();
      for (const r of photoRows.data ?? []) {
        const p = (r as { original_url: string | null }).original_url;
        if (typeof p === 'string') attached.add(p);
      }
      for (const r of coverRows.data ?? []) {
        const p = (r as { cover_path: string | null }).cover_path;
        if (typeof p === 'string') attached.add(p);
      }
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
