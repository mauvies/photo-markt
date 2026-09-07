/**
 * Integration tests for `cleanupRateLimitBuckets` (T-218).
 *
 * Drives the exported flow body against local Supabase with a pass-through
 * step and an explicit clock — same shape as `reconcile-indexing.test.ts`.
 * What must hold: rows past the retention go, the live window (and anything
 * inside the retention) survives, and a backlog is drained in bounded
 * batches rather than one statement.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseServerClient } from '@/database/queries/types';
import {
  MAX_PURGE_BATCHES_PER_TICK,
  PURGE_BATCH_SIZE,
  RATE_LIMIT_BUCKET_RETENTION_SEC,
  runCleanupRateLimitBucketsFlow,
} from '@/lib/inngest/functions/cleanup-rate-limit-buckets';
import type { InngestStepRunner } from '@/lib/inngest/step';
import { computeWindow, MAX_RATE_LIMIT_WINDOW_SEC } from '@/lib/rate-limit';
import { createServiceClient, resetDatabase } from '../../helpers/supabase-test-client';

const HOUR_MS = 60 * 60 * 1000;
const RETENTION_MS = RATE_LIMIT_BUCKET_RETENTION_SEC * 1000;

/** A fixed "now" so every window the test seeds is computed against one clock. */
const NOW = new Date('2026-08-01T12:30:00.000Z').getTime();

const passthroughStep: InngestStepRunner = {
  async run<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};

const client = () => createServiceClient() as unknown as SupabaseServerClient;

async function seed(rows: { key: string; windowStart: Date; count?: number }[]) {
  const { error } = await createServiceClient()
    .from('rate_limit_buckets')
    .insert(
      rows.map((r) => ({
        bucket_key: r.key,
        window_start: r.windowStart.toISOString(),
        count: r.count ?? 1,
      })),
    );
  if (error) throw new Error(`seed: ${error.message}`);
}

async function remainingKeys(): Promise<string[]> {
  const { data, error } = await createServiceClient()
    .from('rate_limit_buckets')
    .select('bucket_key')
    .order('bucket_key');
  if (error) throw new Error(`remainingKeys: ${error.message}`);
  return (data ?? []).map((r) => r.bucket_key as string);
}

describe('cleanupRateLimitBuckets (T-218)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('deletes rows past the retention and keeps the live window', async () => {
    const liveHourly = computeWindow(NOW, 3600).start;
    const liveDaily = computeWindow(NOW, MAX_RATE_LIMIT_WINDOW_SEC).start;
    // Just inside the retention: the window started one hour short of the cutoff.
    const insideRetention = new Date(NOW - RETENTION_MS + HOUR_MS);
    // Just past it, and far past it.
    const justExpired = new Date(NOW - RETENTION_MS - HOUR_MS);
    const longExpired = new Date(NOW - 30 * 24 * HOUR_MS);

    await seed([
      { key: 'thumb:live', windowStart: liveHourly, count: 42 },
      { key: 'face-search-daily:live', windowStart: liveDaily, count: 7 },
      { key: 'thumb:inside', windowStart: insideRetention },
      { key: 'thumb:just-expired', windowStart: justExpired },
      { key: 'thumb:long-expired', windowStart: longExpired },
    ]);

    const result = await runCleanupRateLimitBucketsFlow(passthroughStep, NOW, { client: client() });

    expect(result.deleted).toBe(2);
    expect(result.truncated).toBe(false);
    expect(await remainingKeys()).toEqual(['face-search-daily:live', 'thumb:inside', 'thumb:live']);

    // The live counter is untouched — not reset, not recounted.
    const { data } = await createServiceClient()
      .from('rate_limit_buckets')
      .select('count')
      .eq('bucket_key', 'thumb:live')
      .single();
    expect(data?.count).toBe(42);
  });

  it('is a no-op on an empty table', async () => {
    const result = await runCleanupRateLimitBucketsFlow(passthroughStep, NOW, { client: client() });
    expect(result).toMatchObject({ deleted: 0, batches: 1, truncated: false });
  });

  it('drains a backlog in bounded batches, oldest first', async () => {
    // More expired rows than one batch, fewer than the per-tick ceiling.
    const total = PURGE_BATCH_SIZE * 2 + 5;
    const base = NOW - RETENTION_MS - 24 * HOUR_MS;
    await seed(
      Array.from({ length: total }, (_, i) => ({
        key: `old:${String(i).padStart(5, '0')}`,
        // Spread across distinct windows so `order by window_start` has work to do.
        windowStart: new Date(base - i * 1000),
      })),
    );
    await seed([{ key: 'thumb:live', windowStart: computeWindow(NOW, 3600).start }]);

    const result = await runCleanupRateLimitBucketsFlow(passthroughStep, NOW, { client: client() });

    expect(result.deleted).toBe(total);
    expect(result.batches).toBe(3);
    expect(result.truncated).toBe(false);
    expect(await remainingKeys()).toEqual(['thumb:live']);
  });

  it('stops at the per-tick ceiling and reports the truncation', async () => {
    // Prove the valve without seeding 50k rows: a batch of one hits the
    // ceiling after MAX_PURGE_BATCHES_PER_TICK deletions.
    const total = MAX_PURGE_BATCHES_PER_TICK + 3;
    const base = NOW - RETENTION_MS - 24 * HOUR_MS;
    await seed(
      Array.from({ length: total }, (_, i) => ({
        key: `old:${String(i).padStart(3, '0')}`,
        windowStart: new Date(base - i * 1000),
      })),
    );

    const result = await runCleanupRateLimitBucketsFlow(passthroughStep, NOW, {
      client: client(),
      batchSize: 1,
    });

    expect(result.batches).toBe(MAX_PURGE_BATCHES_PER_TICK);
    expect(result.deleted).toBe(MAX_PURGE_BATCHES_PER_TICK);
    expect(result.truncated).toBe(true);
    expect((await remainingKeys()).length).toBe(total - MAX_PURGE_BATCHES_PER_TICK);
  });
});
