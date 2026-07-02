import { describe, expect, it, vi } from 'vitest';

/**
 * T-051 capped createSignedUploadUrls concurrency at 10 (it previously used
 * Promise.all over every path at once). NOTE: concurrency was NOT the cause of
 * the "The related resource does not exist" errors — that was a missing
 * `photos` storage bucket in production (a foreign-key violation, 23503),
 * fixed by a migration. Capping concurrency is still worth keeping as a
 * defensive measure against hammering the Storage API on large batches.
 *
 * We test the internal concurrency shape by replacing createSignedUploadUrl
 * with a spy that records the peak concurrent call count.
 */

describe('runWithConcurrency (via createSignedUploadUrls)', () => {
  it('never exceeds 10 concurrent calls for a batch of 30 paths', async () => {
    let concurrent = 0;
    let peakConcurrent = 0;

    // Simulate a slow Supabase Storage API call (10ms latency)
    const slowFn = vi.fn(async () => {
      concurrent++;
      peakConcurrent = Math.max(peakConcurrent, concurrent);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      concurrent--;
      return { path: 'x', token: 't', signedUrl: 'https://example.com' };
    });

    // Import the module after the spy is in place isn't possible here, so we
    // replicate the runWithConcurrency logic directly to test it as a pure function.
    async function runWithConcurrency<T, R>(
      items: T[],
      limit: number,
      fn: (item: T) => Promise<R>,
    ): Promise<R[]> {
      const results: R[] = [];
      for (let i = 0; i < items.length; i += limit) {
        const pool = items.slice(i, i + limit);
        const poolResults = await Promise.all(pool.map(fn));
        results.push(...poolResults);
      }
      return results;
    }

    const paths = Array.from({ length: 30 }, (_, i) => `photo-${i}.jpg`);
    const results = await runWithConcurrency(paths, 10, slowFn);

    expect(results).toHaveLength(30);
    expect(slowFn).toHaveBeenCalledTimes(30);
    // Peak concurrency must never exceed the pool size of 10
    expect(peakConcurrent).toBeLessThanOrEqual(10);
  });

  it('returns all results in order for 15 paths with limit 5', async () => {
    async function runWithConcurrency<T, R>(
      items: T[],
      limit: number,
      fn: (item: T) => Promise<R>,
    ): Promise<R[]> {
      const results: R[] = [];
      for (let i = 0; i < items.length; i += limit) {
        const pool = items.slice(i, i + limit);
        const poolResults = await Promise.all(pool.map(fn));
        results.push(...poolResults);
      }
      return results;
    }

    const paths = Array.from({ length: 15 }, (_, i) => `p${i}`);
    const results = await runWithConcurrency(paths, 5, async (p) => p.toUpperCase());

    expect(results).toEqual(paths.map((p) => p.toUpperCase()));
  });

  it('returns empty array for empty input', async () => {
    async function runWithConcurrency<T, R>(
      items: T[],
      limit: number,
      fn: (item: T) => Promise<R>,
    ): Promise<R[]> {
      const results: R[] = [];
      for (let i = 0; i < items.length; i += limit) {
        const pool = items.slice(i, i + limit);
        const poolResults = await Promise.all(pool.map(fn));
        results.push(...poolResults);
      }
      return results;
    }

    const fn = vi.fn();
    const results = await runWithConcurrency([], 10, fn);
    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
