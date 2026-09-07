import type { SupabaseServerClient } from './types';

/**
 * Delete one batch of `rate_limit_buckets` rows whose window started before
 * `cutoff`, oldest first. Returns how many rows went.
 *
 * Batched on purpose (T-218): the first run on a table that has never been
 * purged can hold hundreds of thousands of rows, and a single unbounded
 * `DELETE` there is one long-held lock and one statement-timeout away from
 * doing nothing at all.
 *
 * ⚠️ Goes through the `purge_rate_limit_buckets` RPC, not a PostgREST
 * `.delete().limit(n)`: PostgREST 13 accepts `limit` on a DELETE and then
 * deletes every matching row anyway (verified locally while building this —
 * 5 seeded, `limit=2` sent, 5 deleted). The LIMIT has to live in the
 * statement for the batch to be real. Service-role only — the table has RLS
 * enabled with no policies, and the RPC is revoked from the API roles.
 */
export async function deleteRateLimitBucketsBefore(
  supabase: SupabaseServerClient,
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('purge_rate_limit_buckets', {
    p_cutoff: cutoff.toISOString(),
    p_limit: batchSize,
  });
  if (error) throw error;
  if (typeof data !== 'number') {
    throw new Error('purge_rate_limit_buckets returned non-number');
  }
  return data;
}
