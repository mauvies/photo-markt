/**
 * `photo.processed` worker: generate small (400px) and medium (800px) WebP
 * thumbnails for every processed photo.
 *
 * Triggers on `photo.processed` (emitted by index-photo-faces once indexing
 * settles) rather than `photo.uploaded`, so a photo's face boxes are already
 * persisted when we bake. Thumbnails are content-addressed and cached
 * immutably, so their single bake must already carry the face blur (T-068) —
 * chaining after indexing is what makes that possible.
 *
 * Re-bake cache-busting (T-078): the /api/thumb URL is content-addressed and
 * served `immutable, max-age=1y`, so a thumbnail re-baked with blur (AI enabled
 * after upload / re-index) writes the SAME path and the CDN would keep serving
 * the stale unblurred copy. `mark-ready` bumps `photos.thumb_version` on every
 * bake; readers append it as `?v=N`, giving the re-baked thumbnail a fresh CDN
 * cache key while unchanged photos keep their cached URL.
 *
 * Step ordering (3 steps; bytes NEVER cross step boundaries):
 *
 *   1. load-context        → small JSON: event watermark_enabled flag +
 *                            photo upload_status + thumbnail_status. Bails
 *                            early on rejected/missing photos (race with
 *                            index-photo-faces validation step) and on an
 *                            already-`ready` thumbnail when the trigger didn't
 *                            set `force` (ready-guard, T-092 — avoids a
 *                            pointless re-bake + CDN churn on bare re-emissions).
 *   2. generate-and-upload → THE mega-step. Downloads original, for paid
 *                            events blurs every indexed face + applies
 *                            watermark, resizes to small + medium WebP,
 *                            uploads both to storage. Returns only
 *                            { outcome }. Buffers never escape.
 *   3. mark-ready          → UPDATE thumbnail_status='ready' + invalidate
 *                            event photo cache tags.
 *
 * Why a separate function instead of adding steps to index-photo-faces:
 * independent retries and different failure modes. It is chained after
 * indexing (via `photo.processed`) only so face boxes are available at bake
 * time; the two functions still retry independently.
 *
 * safeCall convention: wrap every Sharp/Supabase Storage call — SDK errors
 * can carry buffer references that blow past Inngest's ~4 MB per-step output
 * cap on serialization. safeCall re-throws a plain message-only Error.
 */

import { NonRetriableError } from 'inngest';
import type { ThumbnailStatus } from '@/database/queries/photos';
import { markPhotoThumbnailReady, updatePhotoThumbnailStatus } from '@/database/queries/photos';
import { getPhotoFaceBoxesByStoragePath } from '@/database/queries/rekognition';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { revalidateEventDetailTags } from '@/lib/event-cache-tags';
import { safeCall } from '@/lib/safe-call';
import { isStorageObjectNotFound } from '@/lib/storage-object-not-found';
import { generateThumbnail, thumbStoragePath } from '@/lib/thumbnails';
import { addWatermarkToImage, type FaceBox } from '@/lib/watermark';
import { inngest } from '../client';
import type { PhotoUploadedPayload, PhotoUploadStep } from './index-photo-faces';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

interface ContextResult {
  watermarkEnabled: boolean;
  /** null means the photo was deleted or rejected before we ran */
  uploadStatus: string | null;
  /** current thumbnail_status — drives the ready-guard skip (T-092) */
  thumbnailStatus: string | null;
}

type GenerateOutcome = 'generated' | 'skipped' | 'no-original';

async function loadContext(photoId: string, eventId: string): Promise<ContextResult> {
  const [photoResult, eventResult] = await Promise.all([
    adminClient
      .from('photos')
      .select('upload_status, thumbnail_status')
      .eq('id', photoId)
      .maybeSingle(),
    adminClient.from('events').select('watermark_enabled').eq('id', eventId).maybeSingle(),
  ]);
  return {
    watermarkEnabled: Boolean(eventResult.data?.watermark_enabled),
    uploadStatus: (photoResult.data?.upload_status as string | null) ?? null,
    thumbnailStatus: (photoResult.data?.thumbnail_status as string | null) ?? null,
  };
}

// Thumbnail readiness doesn't change the approved-photo count — the
// upload_status promotion (and its listing-tag bust) already happened
// upstream in index-photo-faces — so only the detail tag needs a bust here
// for the new thumbnail to show up.
async function invalidateEventPhotoCache(eventId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('events')
      .select('slug, share_code')
      .eq('id', eventId)
      .maybeSingle();
    revalidateEventDetailTags({
      id: eventId,
      slug: (data?.slug as string | null) ?? null,
      share_code: (data?.share_code as string | null) ?? null,
    });
  } catch (err) {
    console.error('[generate-photo-thumbnails] revalidateTag failed', err);
  }
}

export const generatePhotoThumbnails = inngest.createFunction(
  {
    id: 'generate-photo-thumbnails',
    concurrency: [{ limit: 5, key: 'event.data.eventId' }],
    retries: 3,
    triggers: [{ event: 'photo.processed' }],
    onFailure: async ({ event }) => {
      const inner = (event.data as { event?: { data?: PhotoUploadedPayload } })?.event;
      const photoId = inner?.data?.photoId;
      if (!photoId) return;
      try {
        await updatePhotoThumbnailStatus(adminClient, photoId, 'failed' as ThumbnailStatus);
      } catch (err) {
        console.error('[generate-photo-thumbnails] onFailure cleanup failed', err);
      }
    },
  },
  async ({ event, step }) => {
    return await runGeneratePhotoThumbnailsFlow(
      event.data as PhotoUploadedPayload,
      step as unknown as PhotoUploadStep,
    );
  },
);

export async function runGeneratePhotoThumbnailsFlow(
  payload: PhotoUploadedPayload,
  step: PhotoUploadStep,
): Promise<unknown> {
  const { photoId, eventId, storagePath, force } = payload;

  console.log(`[generate-photo-thumbnails] start photoId=${photoId} eventId=${eventId}`);

  // ── 1. load-context ──────────────────────────────────────────────────
  // Check whether the photo still exists and isn't rejected. index-photo-faces
  // runs concurrently and may reject+delete invalid bytes before we start.
  const ctx: ContextResult = await step.run('load-context', () => loadContext(photoId, eventId));

  // Photo was rejected/deleted by the validator — no thumbnails needed.
  if (ctx.uploadStatus === null || ctx.uploadStatus === 'rejected') {
    console.log(
      `[generate-photo-thumbnails] skipping photoId=${photoId} uploadStatus=${ctx.uploadStatus}`,
    );
    return { outcome: 'skipped', reason: 'rejected-or-missing' };
  }

  // Ready-guard (T-092): a thumbnail already baked `ready` doesn't need
  // re-baking on a bare `photo.processed` re-emission (re-index of non-indexed
  // photos, disable→re-enable of AI) — re-baking would re-download the
  // original, re-run watermark+blur+2×resize+2×upload and bump `thumb_version`,
  // pointlessly busting the immutable /api/thumb CDN entry. Skip UNLESS `force`
  // is set, which index-photo-faces sets only when this run (re)wrote face
  // boxes and the baked-in blur may have changed (never skip the T-078 re-bake).
  if (ctx.thumbnailStatus === 'ready' && !force) {
    console.log(`[generate-photo-thumbnails] skipping photoId=${photoId} already ready (no force)`);
    return { outcome: 'skipped', reason: 'already-ready' };
  }

  // ── 2. generate-and-upload ───────────────────────────────────────────
  // Mega-step: download → (watermark for paid) → resize both variants →
  // upload. Buffers are stack-local and GC'd on step exit — never serialized.
  const generateOutcome: GenerateOutcome = await step.run('generate-and-upload', async () => {
    // 2a. Download the original.
    const { data: blob, error: downloadError } = await safeCall('thumb:download', () =>
      supabaseAdmin.storage.from('photos').download(storagePath),
    );
    if (downloadError || !blob) {
      const message = `thumb:download failed for ${storagePath}: ${downloadError?.message ?? 'no data'}`;
      // Definitive — retrying won't make the object appear (see T-071: the
      // classic local-dev cause is an env mismatch between where the photo was
      // uploaded and where this worker actually runs).
      if (isStorageObjectNotFound(downloadError)) throw new NonRetriableError(message);
      throw new Error(message);
    }
    const originalBuffer = Buffer.from(await blob.arrayBuffer());

    // 2b. For paid events, watermark the source (and blur every indexed face)
    //     so the stored thumbnail is degraded+watermarked+face-blurred — the
    //     original never becomes the thumb. Face boxes are best-effort: a
    //     lookup failure just yields the watermark-only thumbnail, never a
    //     failed job. We're chained after indexing, so boxes are present when
    //     the event actually has faces.
    let faceBoxes: FaceBox[] = [];
    if (ctx.watermarkEnabled) {
      try {
        faceBoxes = await getPhotoFaceBoxesByStoragePath(adminClient, storagePath);
      } catch (faceErr) {
        console.error('[generate-photo-thumbnails] face box lookup failed (no blur)', faceErr);
      }
    }
    const source = ctx.watermarkEnabled
      ? await safeCall('thumb:watermark', () => addWatermarkToImage(originalBuffer, faceBoxes))
      : originalBuffer;

    // 2c. Resize to small + medium WebP.
    const [smallBuf, mediumBuf] = await Promise.all([
      safeCall('thumb:resize-small', () => generateThumbnail(source, 'small')),
      safeCall('thumb:resize-medium', () => generateThumbnail(source, 'medium')),
    ]);

    // 2d. Upload both thumbnails. upsert=true so a retry doesn't fail on
    //     an existing object from a previous attempt.
    const smallPath = thumbStoragePath(storagePath, 'small');
    const mediumPath = thumbStoragePath(storagePath, 'medium');

    await Promise.all([
      safeCall('thumb:upload-small', async () => {
        const { error } = await supabaseAdmin.storage
          .from('photos')
          .upload(smallPath, smallBuf, { contentType: 'image/webp', upsert: true });
        if (error) throw new Error(error.message);
      }),
      safeCall('thumb:upload-medium', async () => {
        const { error } = await supabaseAdmin.storage
          .from('photos')
          .upload(mediumPath, mediumBuf, { contentType: 'image/webp', upsert: true });
        if (error) throw new Error(error.message);
      }),
    ]);

    return 'generated' as GenerateOutcome;
  });

  if (generateOutcome !== 'generated') {
    return { outcome: generateOutcome };
  }

  // ── 3. mark-ready ────────────────────────────────────────────────────
  // Flip thumbnail_status → ready, bump thumb_version (busts the immutable
  // /api/thumb CDN cache for a re-bake, T-078), and revalidate the cached
  // event page so galleries serve the new thumbs without waiting for the TTL.
  await step.run('mark-ready', async () => {
    await markPhotoThumbnailReady(adminClient, photoId);
    await invalidateEventPhotoCache(eventId);
  });

  return { outcome: 'generated' };
}
