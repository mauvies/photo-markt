/**
 * Cron worker: reconcile the AI face-indexing pipeline's "silent wedge" states
 * every hour (F-18, caching audit T-083).
 *
 * The pipeline has two failure modes with no self-healing path:
 *
 *   1. An event stays `ai_matching_status='indexing'` forever. The status flips
 *      to `ready` only inside the per-photo worker's `maybe-mark-event-ready`
 *      step (index-photo-faces), which runs only when a photo settles as
 *      `indexed` and the in-flight count hits 0. A single lost `photo.uploaded`
 *      (photo never processed → stays in-flight) or a lost `maybe-mark` step
 *      (in-flight already 0 but nobody flipped it) leaves the event wedged. The
 *      only prior recovery was a manual one-off migration.
 *
 *   2. A thumbnail never bakes. `emit-processed` (index-photo-faces) is
 *      best-effort — a swallowed send means `generate-photo-thumbnails` never
 *      runs, so `thumbnail_status` stays `pending` and the gallery serves the
 *      per-view `/api/watermark` fallback (paying its cost) indefinitely.
 *
 *   3. An OWNER upload stays `upload_status='pending'` forever (T-183). Owner
 *      uploads never need moderation, so the worker's `promote-upload-status`
 *      step always approves them — but a lost `photo.uploaded` (or a run that
 *      died before step 3) strands the row `pending`: invisible on the
 *      approved-only public/talent galleries AND absent from the owner's Pending
 *      tab (which excludes owner uploads), so the dashboard count says N while
 *      only the approved subset renders. The T-099 stuck-`indexing` branch never
 *      covered this — the reported event sat in `ai_matching_status='idle'`.
 *
 * This cron closes all three:
 *   (a) For events wedged in `indexing` past the staleness window with photos
 *       still in-flight → re-emit `photo.uploaded` to re-drive them.
 *   (b) For events wedged in `indexing` whose in-flight count is already 0 →
 *       flip to `ready` (the missed `maybe-mark`).
 *   (c) For terminally-indexed photos whose thumbnail is still `pending` past
 *       the window → re-emit `photo.processed` to re-drive the bake.
 *   (d) For owner uploads stuck `upload_status='pending'` past the window (in
 *       events NOT wedged in `indexing`, which (a) already covers) → re-emit
 *       `photo.uploaded` to re-drive download → byte-validation → promotion. We
 *       re-drive the real pipeline rather than flipping the row to `approved`
 *       here, so the byte-validation gate is never skipped.
 *
 * Idempotent + conservative: a 1-hour staleness gate keeps the sweep from
 * fighting live work (a normal index/re-index drains in seconds, and the T-092
 * ready-guard stops any re-emit from re-baking an already-`ready` thumbnail), so
 * a wedge that takes up to an hour to self-heal is preferred over a sweeper that
 * clobbers in-flight jobs. `failed` photos are deliberately left alone — they
 * already exhausted their retries; auto-requeuing them here would be a retry
 * storm (re-index is a manual action).
 *
 * Why Inngest (not pg_cron): Supabase Free has no pg_cron; Inngest is already in
 * the stack with cron triggers on its free plan. No new infra.
 */

import {
  listPhotosWithStuckThumbnails,
  listStuckPendingOwnerUploads,
} from '@/database/queries/photos';
import {
  countEventPhotosInFlight,
  listEventPhotosByStatuses,
  listStuckIndexingEvents,
  updateEventRekognitionState,
} from '@/database/queries/rekognition';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { inngest } from '../client';
import type { InngestStepRunner } from '../step';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

/** A photo/event is "stuck" only after sitting in its state this long. */
const STUCK_AGE_MS = 60 * 60 * 1000; // 1 hour
/** Bound each tick. Generous headroom at current scale; safety valve otherwise. */
const MAX_EVENTS_PER_TICK = 200;
const MAX_THUMBNAILS_PER_TICK = 500;
/** Cap the re-drive list so the `reconcile-stuck-events` step output stays well
 *  under Inngest's ~4 MB limit (each entry ~150 B). Any overflow is picked up on
 *  the next tick — a wedge draining across a few ticks is fine. */
const MAX_REQUEUE_PHOTOS_PER_TICK = 1000;

/**
 * Narrow sender for the re-drive fan-out. Injected (defaults to `inngest.send`)
 * so the integration test can spy on the emitted events without an Inngest
 * runtime.
 */
export type ReconcileFanoutSender = (
  events: Array<
    | { name: 'photo.uploaded'; data: { photoId: string; eventId: string; storagePath: string } }
    | {
        name: 'photo.processed';
        data: { photoId: string; eventId: string; storagePath: string; force: boolean };
      }
  >,
) => Promise<unknown>;

const defaultSender: ReconcileFanoutSender = (events) => inngest.send(events);

export interface ReconcileResult {
  eventsMarkedReady: number;
  photosRequeued: number;
  thumbnailsRequeued: number;
  /** Owner uploads stuck in `upload_status='pending'` that were re-driven (T-183). */
  ownerUploadsRequeued: number;
}

export const reconcileIndexingState = inngest.createFunction(
  {
    id: 'reconcile-indexing-state',
    // The cron is single-threaded by Inngest scheduling; cap anyway as defense
    // in depth so two ticks can never overlap and double-emit.
    concurrency: { limit: 1 },
    // 15 and 45 past every hour — offset from cleanup-orphaned-storage (0,30)
    // so the two crons don't contend.
    triggers: [{ cron: '15,45 * * * *' }],
  },
  async ({ step }: { step: InngestStepRunner }) => {
    return await runReconcileIndexingFlow(step, Date.now());
  },
);

/**
 * Pure handler body, exported for the integration test (which passes a
 * pass-through fake step, an explicit `nowMs` so the staleness window is
 * deterministic, and a spy sender).
 */
export async function runReconcileIndexingFlow(
  step: InngestStepRunner,
  nowMs: number,
  send: ReconcileFanoutSender = defaultSender,
): Promise<ReconcileResult> {
  const staleBeforeIso = new Date(nowMs - STUCK_AGE_MS).toISOString();

  // ── 1. Events wedged in `indexing` ───────────────────────────────────
  // For each stale wedged event: drained (in-flight 0) → flip to ready (b);
  // still in-flight → collect its pending/indexing photos to re-drive (a).
  const { markedReady, requeue } = await step.run('reconcile-stuck-events', async () => {
    const stuckEvents = await listStuckIndexingEvents(
      adminClient,
      staleBeforeIso,
      MAX_EVENTS_PER_TICK,
    );

    let markedReady = 0;
    const requeue: Array<{ photoId: string; eventId: string; storagePath: string }> = [];

    for (const { id: eventId } of stuckEvents) {
      const inFlight = await countEventPhotosInFlight(adminClient, eventId);
      if (inFlight === 0) {
        await updateEventRekognitionState(adminClient, eventId, { status: 'ready' });
        markedReady += 1;
        console.log(
          `[reconcile-indexing] event ${eventId} drained but stuck 'indexing' → marked ready`,
        );
        continue;
      }
      // Stop collecting once the tick's re-drive budget is full; the rest is
      // swept next tick. Marking-ready above is cheap and continues regardless.
      if (requeue.length >= MAX_REQUEUE_PHOTOS_PER_TICK) continue;
      const photos = await listEventPhotosByStatuses(adminClient, eventId, ['pending', 'indexing']);
      for (const p of photos) {
        if (p.storagePath && requeue.length < MAX_REQUEUE_PHOTOS_PER_TICK) {
          requeue.push({ photoId: p.id, eventId, storagePath: p.storagePath });
        }
      }
    }
    return { markedReady, requeue };
  });

  // ── 2. Re-drive the wedged in-flight photos (a) ───────────────────────
  const photosRequeued = await step.run('requeue-stuck-photos', async () => {
    if (requeue.length === 0) return 0;
    await send(requeue.map((p) => ({ name: 'photo.uploaded' as const, data: p })));
    console.log(
      `[reconcile-indexing] re-emitted photo.uploaded for ${requeue.length} stuck photo(s)`,
    );
    return requeue.length;
  });

  // ── 3. Re-drive stuck thumbnails (c) ──────────────────────────────────
  // `force: false` — the photos are `thumbnail_status='pending'` (never baked),
  // so the T-092 ready-guard bakes them; force is only for re-baking an already
  // `ready` thumbnail, which never applies here.
  const thumbnailsRequeued = await step.run('requeue-stuck-thumbnails', async () => {
    const stuck = await listPhotosWithStuckThumbnails(
      adminClient,
      staleBeforeIso,
      MAX_THUMBNAILS_PER_TICK,
    );
    if (stuck.length === 0) return 0;
    await send(
      stuck.map((p) => ({
        name: 'photo.processed' as const,
        data: { photoId: p.id, eventId: p.eventId, storagePath: p.storagePath, force: false },
      })),
    );
    console.log(
      `[reconcile-indexing] re-emitted photo.processed for ${stuck.length} stuck thumbnail(s)`,
    );
    return stuck.length;
  });

  // ── 4. Re-drive owner uploads stuck `pending` (d) ─────────────────────
  // Owner uploads never need moderation; a lost `photo.uploaded`/dropped step 3
  // leaves them `pending` and invisible everywhere. Re-emit `photo.uploaded` so
  // the worker re-validates the bytes and promotes to `approved` — the promote
  // step also busts the event photo cache, so newly-approved photos surface on
  // the public/talent galleries without waiting out the TTL.
  const ownerUploadsRequeued = await step.run('requeue-stuck-owner-uploads', async () => {
    const stuck = await listStuckPendingOwnerUploads(
      adminClient,
      staleBeforeIso,
      MAX_REQUEUE_PHOTOS_PER_TICK,
    );
    if (stuck.length === 0) return 0;
    await send(
      stuck.map((p) => ({
        name: 'photo.uploaded' as const,
        data: { photoId: p.id, eventId: p.eventId, storagePath: p.storagePath },
      })),
    );
    console.log(
      `[reconcile-indexing] re-emitted photo.uploaded for ${stuck.length} stuck owner upload(s)`,
    );
    return stuck.length;
  });

  return {
    eventsMarkedReady: markedReady,
    photosRequeued,
    thumbnailsRequeued,
    ownerUploadsRequeued,
  };
}
