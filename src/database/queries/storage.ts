/**
 * Storage-related database queries
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

/**
 * Create a signed URL for a single file
 */
export async function createSignedUrl(
  supabase: SupabaseServerClient,
  bucket: string,
  path: string,
  expiresIn = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

/**
 * Create signed URLs for multiple files
 */
export async function createSignedUrls(
  supabase: SupabaseServerClient,
  bucket: string,
  paths: string[],
  expiresIn = 3600,
): Promise<Array<{ path: string; signedUrl: string | null }>> {
  if (paths.length === 0) {
    return [];
  }

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, expiresIn);

  if (error || !data) {
    // Fallback: sign individually
    const results = await Promise.all(
      paths.map(async (path) => {
        const signedUrl = await createSignedUrl(supabase, bucket, path, expiresIn);
        return {
          path,
          signedUrl,
        };
      }),
    );
    return results;
  }

  return data
    .map((item) => ({
      path: item.path ?? '',
      signedUrl: item.signedUrl ?? null,
    }))
    .filter((item) => item.path !== '') as Array<{
    path: string;
    signedUrl: string | null;
  }>;
}

/**
 * Mint a single signed UPLOAD URL the client PUTs photo bytes to directly.
 *
 * Unlike `createSignedUrl` (download), Supabase's `createSignedUploadUrl`
 * is single-use and does not accept a TTL parameter — the server default
 * (~2h) applies. Orphan cleanup is handled separately by the Inngest cron
 * (`cleanup-orphaned-storage-files`), so TTL isn't load-bearing here.
 */
export async function createSignedUploadUrl(
  supabase: SupabaseServerClient,
  bucket: string,
  path: string,
  options?: { upsert?: boolean },
): Promise<{ path: string; token: string; signedUrl: string }> {
  const upsert = options?.upsert ?? false;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path, { upsert });

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed upload URL: ${getErrorMessage(error)}`);
  }

  return {
    path: data.path ?? path,
    token: data.token,
    signedUrl: data.signedUrl,
  };
}

/**
 * Run `fn` over `items` with at most `limit` concurrent executions at once.
 * Processes in sequential pools of `limit`; waits for each pool before starting
 * the next. Prevents thundering-herd against APIs with per-connection limits.
 */
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

const SIGNED_UPLOAD_URL_CONCURRENCY = 10;

/**
 * Batch variant of `createSignedUploadUrl`. Fails the whole batch on any
 * per-path failure — partial success would force callers to track which
 * subset of files to re-mint URLs for, which is a footgun. Loud-and-retry
 * is the better default.
 *
 * Concurrency is capped at SIGNED_UPLOAD_URL_CONCURRENCY (10) to avoid
 * saturating the Supabase Storage API when called with large batches.
 */
export async function createSignedUploadUrls(
  supabase: SupabaseServerClient,
  bucket: string,
  paths: string[],
  options?: { upsert?: boolean },
): Promise<Array<{ path: string; token: string; signedUrl: string }>> {
  if (paths.length === 0) {
    return [];
  }
  return runWithConcurrency(paths, SIGNED_UPLOAD_URL_CONCURRENCY, (p) =>
    createSignedUploadUrl(supabase, bucket, p, options),
  );
}

/**
 * List storage objects under a bucket whose `created_at` is older than
 * `olderThanMs` from now. Pages through the bucket up to `maxResults`.
 * Backs the Inngest orphan-cleanup cron.
 *
 * Note: Supabase Storage `.list()` is recursive only when called with a
 * prefix and `sortBy.column = 'created_at'` doesn't propagate into nested
 * folders without a prefix. We page through top-level "user-id" folders
 * and then their per-event subfolders. At early scale this is a single
 * page; the helper paginates defensively for the future.
 */
export async function listStorageObjectsOlderThan(
  supabase: SupabaseServerClient,
  bucket: string,
  olderThanMs: number,
  maxResults = 1000,
): Promise<Array<{ path: string; createdAt: string }>> {
  const cutoff = Date.now() - olderThanMs;
  const out: Array<{ path: string; createdAt: string }> = [];

  // Top-level: photographer owner-id folders + the `collaborative/` prefix.
  const { data: topLevel, error: topErr } = await supabase.storage
    .from(bucket)
    .list('', { limit: maxResults, sortBy: { column: 'created_at', order: 'asc' } });
  if (topErr || !topLevel) {
    throw new Error(`Failed to list storage root: ${getErrorMessage(topErr)}`);
  }

  for (const folder of topLevel) {
    // Storage folders have `id === null`; files have an `id`. Skip files at
    // the root (we never write any) — only descend into folders.
    if (folder.id !== null) continue;
    const folderName = folder.name;

    // List event subfolders under each top-level folder.
    const { data: subfolders } = await supabase.storage
      .from(bucket)
      .list(folderName, { limit: maxResults, sortBy: { column: 'created_at', order: 'asc' } });

    for (const sub of subfolders ?? []) {
      if (sub.id !== null) continue;
      const subPrefix = `${folderName}/${sub.name}`;
      const { data: files } = await supabase.storage.from(bucket).list(subPrefix, {
        limit: maxResults,
        sortBy: { column: 'created_at', order: 'asc' },
      });
      for (const file of files ?? []) {
        if (file.id === null) continue;
        const createdAtRaw = (file as { created_at?: string }).created_at;
        if (!createdAtRaw) continue;
        const createdAtMs = Date.parse(createdAtRaw);
        if (Number.isNaN(createdAtMs) || createdAtMs > cutoff) continue;
        out.push({ path: `${subPrefix}/${file.name}`, createdAt: createdAtRaw });
        if (out.length >= maxResults) return out;
      }
    }
  }

  return out;
}

/**
 * Upload a file to storage
 */
export async function uploadFile(
  supabase: SupabaseServerClient,
  bucket: string,
  path: string,
  file: Buffer | ArrayBuffer | Blob,
  options?: {
    contentType?: string;
    upsert?: boolean;
  },
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: options?.contentType,
    upsert: options?.upsert ?? false,
  });

  if (error) {
    throw new Error(`Failed to upload file: ${getErrorMessage(error)}`);
  }
}

/**
 * Delete files from storage
 */
export async function deleteStorageFiles(
  supabase: SupabaseServerClient,
  bucket: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(bucket).remove(paths);

  if (error) {
    throw new Error(`Failed to delete storage files: ${getErrorMessage(error)}`);
  }
}

/**
 * Create photo URLs with optional watermark support
 * If useWatermark is true, returns watermark API URLs instead of signed URLs
 */
export async function createPhotoUrls(
  supabase: SupabaseServerClient,
  bucket: string,
  paths: string[],
  options?: {
    expiresIn?: number;
    useWatermark?: boolean;
    baseUrl?: string;
  },
): Promise<Array<{ path: string; signedUrl: string | null }>> {
  const { useWatermark = false, baseUrl, expiresIn = 3600 } = options ?? {};

  if (useWatermark) {
    // Fail-CLOSED: if the caller asked for watermarked URLs but we can't
    // build them (missing baseUrl), do NOT silently fall back to direct
    // signed URLs — that would expose the original, payment-gated image.
    // Returning null lets the consumer hide the photo or render a placeholder.
    if (!baseUrl) {
      console.error(
        '[watermark-error] createPhotoUrls called with useWatermark=true but no baseUrl — returning null URLs to avoid leaking originals',
      );
      return paths.map((p) => ({ path: p, signedUrl: null }));
    }
    return paths.map((path) => ({
      path,
      signedUrl: `${baseUrl}/api/watermark/${path}`,
    }));
  }

  // No watermark requested — caller is OK with direct signed URLs.
  return createSignedUrls(supabase, bucket, paths, expiresIn);
}
