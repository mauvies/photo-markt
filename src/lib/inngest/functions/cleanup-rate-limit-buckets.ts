/**
 * Cron worker: purge expired `rate_limit_buckets` rows (T-218).
 *
 * The limiter writes one row per `(bucket_key, window_start)` and nothing
 * ever read an old one again — hourly `(event, IP)` buckets plus the daily
 * cost counters grow with traffic × events and never stop. That is the kind
 * of table that becomes an incident exactly when real traffic arrives, and
 * the failure is the worst shape available: `rateLimit` FAILS OPEN on a
 * backend error, so a degraded table silently switches off every throttle —
 * including the ones gating AWS spend — at the moment they matter most. (The
 * cost breaker fails closed, so face search would degrade to "unavailable"
 * rather than uncapping the bill; the rest would just open.)
 *
 * Retention is `2 × MAX_RATE_LIMIT_WINDOW_SEC`, and that constant is enforced
 * at every `rateLimit` call — a limiter cannot declare a window the purge
 * would cut through. Twice the window, not once: a bucket whose window ended
 * a moment ago is still the one a request straddling the boundary reads, and
 * the tests seed buckets against a frozen clock; one full extra window of
 * slack costs nothing and removes every off-by-one.
 *
 * Deletes in bounded batches, oldest first, with a per-tick ceiling — the
 * first run on a never-purged table must not be one giant statement. Anything
 * left over is picked up next hour; `truncated` in the return value says so.
 * The batch is a `LIMIT` inside the `purge_rate_limit_buckets` RPC, because
 * PostgREST ignores `limit` on a DELETE (see the query's header).
 *
 * Hourly at :20 — the fifth cron slot. The others sit at 0,30 · 10,40 ·
 * 15,45 · 25,55; buckets only expire on the hour anyway, so twice an hour
 * would just be churn.
 */

import { deleteRateLimitBucketsBefore } from '@/database/queries/rate-limit-buckets';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { MAX_RATE_LIMIT_WINDOW_SEC } from '@/lib/rate-limit';
import { inngest } from '../client';
import type { InngestStepRunner } from '../step';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

/** How long a bucket is kept past the start of its window. See the header. */
export const RATE_LIMIT_BUCKET_RETENTION_SEC = 2 * MAX_RATE_LIMIT_WINDOW_SEC;

/** Rows per DELETE. Small enough that no single statement holds the table. */
export const PURGE_BATCH_SIZE = 1000;
/** Batches per tick — the safety valve for a backlog. 50k rows an hour. */
export const MAX_PURGE_BATCHES_PER_TICK = 50;

export interface CleanupRateLimitBucketsResult {
  deleted: number;
  batches: number;
  /** True when the per-tick ceiling was hit and older rows remain. */
  truncated: boolean;
  cutoff: string;
}

export const cleanupRateLimitBuckets = inngest.createFunction(
  {
    id: 'cleanup-rate-limit-buckets',
    // Two overlapping purges would only contend on the same oldest rows.
    concurrency: { limit: 1 },
    triggers: [{ cron: '20 * * * *' }],
  },
  async ({ step }: { step: InngestStepRunner }) => {
    return await runCleanupRateLimitBucketsFlow(step, Date.now());
  },
);

/** Injected by the integration test: a local client, and a tiny batch to hit the valve. */
export interface CleanupRateLimitBucketsOptions {
  client?: SupabaseServerClient;
  batchSize?: number;
}

/**
 * The flow body, exported so the integration test can drive it against local
 * Supabase with a pass-through step and an explicit clock.
 */
export async function runCleanupRateLimitBucketsFlow(
  step: InngestStepRunner,
  nowMs: number,
  { client = adminClient, batchSize = PURGE_BATCH_SIZE }: CleanupRateLimitBucketsOptions = {},
): Promise<CleanupRateLimitBucketsResult> {
  const cutoff = new Date(nowMs - RATE_LIMIT_BUCKET_RETENTION_SEC * 1000);

  // One step, one loop: each batch is its own statement, and a failure part-way
  // simply leaves the rest for the next hour — a purge has nothing to memoize.
  const outcome = await step.run('purge-expired-buckets', async () => {
    let deleted = 0;
    let batches = 0;
    while (batches < MAX_PURGE_BATCHES_PER_TICK) {
      const removed = await deleteRateLimitBucketsBefore(client, cutoff, batchSize);
      batches += 1;
      deleted += removed;
      if (removed < batchSize) {
        return { deleted, batches, truncated: false };
      }
    }
    return { deleted, batches, truncated: true };
  });

  if (outcome.truncated) {
    console.warn('[cleanup-rate-limit-buckets] hit the per-tick ceiling; older rows remain', {
      deleted: outcome.deleted,
      batches: outcome.batches,
      cutoff: cutoff.toISOString(),
    });
  }

  return { ...outcome, cutoff: cutoff.toISOString() };
}
