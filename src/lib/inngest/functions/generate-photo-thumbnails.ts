/**
 * `photo.uploaded` worker: generate small (400px) and medium (800px) WebP
 * thumbnails for every new photo upload.
 *
 * Step ordering (3 steps; bytes NEVER cross step boundaries):
 *
 *   1. load-context        → small JSON: event watermark_enabled flag +
 *                            photo upload_status. Bails early on
 *                            rejected/missing photos (race with
 *                            index-photo-faces validation step).
 *   2. generate-and-upload → THE mega-step. Downloads original, applies
 *                            watermark for paid events, resizes to small +
 *                            medium WebP, uploads both to storage. Returns
 *                            only { outcome }. Buffers never escape.
 *   3. mark-ready          → UPDATE thumbnail_status='ready' + invalidate
 *                            event photo cache tags.
 *
 * Why a separate function instead of adding steps to index-photo-faces:
 * independent retries, no coupling between validation/indexing and thumbnail
 * generation, and the two concerns have different failure modes.
 *
 * safeCall convention: wrap every Sharp/Supabase Storage call — SDK errors
 * can carry buffer references that blow past Inngest's ~4 MB per-step output
 * cap on serialization. safeCall re-throws a plain message-only Error.
 */

import { revalidateTag } from 'next/cache';
import type { ThumbnailStatus } from '@/database/queries/photos';
import { updatePhotoThumbnailStatus } from '@/database/queries/photos';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { safeCall } from '@/lib/safe-call';
import { generateThumbnail, thumbStoragePath } from '@/lib/thumbnails';
import { addWatermarkToImage } from '@/lib/watermark';
import { inngest } from '../client';
import type { PhotoUploadedPayload, PhotoUploadStep } from './index-photo-faces';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

interface ContextResult {
  watermarkEnabled: boolean;
  /** null means the photo was deleted or rejected before we ran */
  uploadStatus: string | null;
}

type GenerateOutcome = 'generated' | 'skipped' | 'no-original';

async function loadContext(photoId: string, eventId: string): Promise<ContextResult> {
  const [photoResult, eventResult] = await Promise.all([
    adminClient.from('photos').select('upload_status').eq('id', photoId).maybeSingle(),
    adminClient.from('events').select('watermark_enabled').eq('id', eventId).maybeSingle(),
  ]);
  return {
    watermarkEnabled: Boolean(eventResult.data?.watermark_enabled),
    uploadStatus: (photoResult.data?.upload_status as string | null) ?? null,
  };
}

async function invalidateEventPhotoCache(eventId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('events')
      .select('slug, share_code')
      .eq('id', eventId)
      .maybeSingle();
    revalidateTag(`event-${eventId}`, 'max');
    const slug = (data?.slug as string | null) ?? null;
    const shareCode = (data?.share_code as string | null) ?? null;
    if (slug) revalidateTag(`event-${slug}`, 'max');
    if (shareCode) revalidateTag(`event-${shareCode}`, 'max');
  } catch (err) {
    console.error('[generate-photo-thumbnails] revalidateTag failed', err);
  }
}

export const generatePhotoThumbnails = inngest.createFunction(
  {
    id: 'generate-photo-thumbnails',
    concurrency: [{ limit: 5, key: 'event.data.eventId' }],
    retries: 3,
    triggers: [{ event: 'photo.uploaded' }],
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
  const { photoId, eventId, storagePath } = payload;

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

  // ── 2. generate-and-upload ───────────────────────────────────────────
  // Mega-step: download → (watermark for paid) → resize both variants →
  // upload. Buffers are stack-local and GC'd on step exit — never serialized.
  const generateOutcome: GenerateOutcome = await step.run('generate-and-upload', async () => {
    // 2a. Download the original.
    const { data: blob, error: downloadError } = await safeCall('thumb:download', () =>
      supabaseAdmin.storage.from('photos').download(storagePath),
    );
    if (downloadError || !blob) {
      throw new Error(
        `thumb:download failed for ${storagePath}: ${downloadError?.message ?? 'no data'}`,
      );
    }
    const originalBuffer = Buffer.from(await blob.arrayBuffer());

    // 2b. For paid events, watermark the source so the stored thumbnail
    //     is degraded+watermarked — the original never becomes the thumb.
    const source = ctx.watermarkEnabled
      ? await safeCall('thumb:watermark', () => addWatermarkToImage(originalBuffer))
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
  // Flip thumbnail_status and bust the cached event page so galleries
  // serve the new thumbs without waiting for the 55-min TTL.
  await step.run('mark-ready', async () => {
    await updatePhotoThumbnailStatus(adminClient, photoId, 'ready' as ThumbnailStatus);
    await invalidateEventPhotoCache(eventId);
  });

  return { outcome: 'generated' };
}
