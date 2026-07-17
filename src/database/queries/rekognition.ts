/**
 * AWS Rekognition database queries
 *
 * Pure DB I/O — no AWS SDK imports here. The Rekognition API client lives
 * in `lib/aws/rekognition-client.ts` (PR 2). This module handles:
 *   - per-event configuration + status (on the `events` table)
 *   - per-photo face records (on the `photo_faces` table)
 *   - per-photo indexing state (on the `photos` table)
 *
 * Service-role-only functions are flagged in their docstring — they expect
 * `supabaseAdmin` because writes happen from the Inngest worker (PR 2),
 * which has no user session.
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export type AiMatchingStatus = 'idle' | 'indexing' | 'ready' | 'failed';

export type FaceIndexStatus =
  | 'pending'
  | 'indexing'
  | 'indexed'
  | 'failed'
  | 'no_faces'
  | 'not_applicable';

export interface EventRekognitionState {
  collectionId: string | null;
  region: string | null;
  status: AiMatchingStatus;
  enabled: boolean;
  containsMinors: boolean;
}

export interface PhotoFace {
  id: string;
  photo_id: string;
  aws_face_id: string;
  aws_collection_id: string;
  confidence: number;
  bounding_box: Record<string, number> | null;
  indexed_at: string;
  created_at: string;
}

export interface UpdateEventRekognitionStateInput {
  collectionId?: string | null;
  region?: string | null;
  status?: AiMatchingStatus;
  enabled?: boolean;
}

export interface AddPhotoFaceInput {
  photoId: string;
  awsFaceId: string;
  awsCollectionId: string;
  confidence: number;
  boundingBox?: Record<string, number> | null;
}

/**
 * Read the AI-matching state for an event. Returns null if the event does
 * not exist or has been soft-deleted.
 */
export async function getEventRekognitionState(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<EventRekognitionState | null> {
  const { data, error } = await supabase
    .from('events')
    .select(
      'rekognition_collection_id, rekognition_region, ai_matching_status, ai_matching_enabled, contains_minors, deleted_at',
    )
    .eq('id', eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get event Rekognition state: ${getErrorMessage(error)}`);
  }
  if (!data || data.deleted_at) return null;

  return {
    collectionId: (data.rekognition_collection_id as string | null) ?? null,
    region: (data.rekognition_region as string | null) ?? null,
    status: (data.ai_matching_status as AiMatchingStatus) ?? 'idle',
    enabled: Boolean(data.ai_matching_enabled),
    containsMinors: Boolean(data.contains_minors),
  };
}

/**
 * Service-role only. Patch any of the new Rekognition-related columns on
 * an event. Callers are responsible for plan/ownership checks before
 * invoking this — the function trusts its inputs because writes flow from
 * the worker, not user-facing actions.
 */
export async function updateEventRekognitionState(
  supabase: SupabaseServerClient,
  eventId: string,
  partial: UpdateEventRekognitionStateInput,
): Promise<void> {
  const updateData: Record<string, unknown> = {};
  if (partial.collectionId !== undefined) {
    updateData.rekognition_collection_id = partial.collectionId;
  }
  if (partial.region !== undefined) {
    updateData.rekognition_region = partial.region;
  }
  if (partial.status !== undefined) {
    updateData.ai_matching_status = partial.status;
  }
  if (partial.enabled !== undefined) {
    updateData.ai_matching_enabled = partial.enabled;
  }
  if (Object.keys(updateData).length === 0) return;

  const { error } = await supabase.from('events').update(updateData).eq('id', eventId);
  if (error) {
    throw new Error(`Failed to update event Rekognition state: ${getErrorMessage(error)}`);
  }
}

/**
 * Service-role only. Insert a face record returned by AWS IndexFaces.
 * The unique constraint on (photo_id, aws_face_id) protects against
 * accidental duplicates from a retry.
 */
export async function addPhotoFace(
  supabase: SupabaseServerClient,
  args: AddPhotoFaceInput,
): Promise<void> {
  const { error } = await supabase.from('photo_faces').insert({
    photo_id: args.photoId,
    aws_face_id: args.awsFaceId,
    aws_collection_id: args.awsCollectionId,
    confidence: args.confidence,
    bounding_box: args.boundingBox ?? null,
  });
  if (error) {
    throw new Error(`Failed to insert photo face: ${getErrorMessage(error)}`);
  }
}

/**
 * Read every face record for an event's photos. Used by the photographer
 * dashboard to display "N faces indexed across M photos". Done as two
 * queries (photos → faces) instead of an inner-join so the return type
 * stays clean — `photo_faces` has no `event_id` column.
 */
export async function getPhotoFacesByEventId(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<PhotoFace[]> {
  const { data: photoRows, error: photosError } = await supabase
    .from('photos')
    .select('id')
    .eq('event_id', eventId)
    .is('deleted_at', null);
  if (photosError) {
    throw new Error(`Failed to list event photos: ${getErrorMessage(photosError)}`);
  }
  const photoIds = (photoRows ?? []).map((row) => row.id as string);
  if (photoIds.length === 0) return [];

  const { data, error } = await supabase
    .from('photo_faces')
    .select(
      'id, photo_id, aws_face_id, aws_collection_id, confidence, bounding_box, indexed_at, created_at',
    )
    .in('photo_id', photoIds);

  if (error) {
    throw new Error(`Failed to get photo faces by event: ${getErrorMessage(error)}`);
  }
  return (data ?? []) as PhotoFace[];
}

/**
 * Service-role only. Read every face record persisted for a single photo.
 * Used by the worker to clear stale faces (a prior partial run / re-index)
 * before calling `IndexFaces` again — see `deletePhotoFacesByPhotoId`.
 */
export async function getPhotoFacesByPhotoId(
  supabase: SupabaseServerClient,
  photoId: string,
): Promise<PhotoFace[]> {
  const { data, error } = await supabase
    .from('photo_faces')
    .select(
      'id, photo_id, aws_face_id, aws_collection_id, confidence, bounding_box, indexed_at, created_at',
    )
    .eq('photo_id', photoId);
  if (error) {
    throw new Error(`Failed to get photo faces by photo id: ${getErrorMessage(error)}`);
  }
  return (data ?? []) as PhotoFace[];
}

/**
 * Point-lookup used in PR 3's talent search: AWS returns a list of
 * matching face_ids, and we resolve them to our photo rows here.
 */
export async function getPhotoFacesByAwsFaceIds(
  supabase: SupabaseServerClient,
  awsFaceIds: string[],
): Promise<PhotoFace[]> {
  if (awsFaceIds.length === 0) return [];
  const { data, error } = await supabase
    .from('photo_faces')
    .select(
      'id, photo_id, aws_face_id, aws_collection_id, confidence, bounding_box, indexed_at, created_at',
    )
    .in('aws_face_id', awsFaceIds);

  if (error) {
    throw new Error(`Failed to get photo faces by AWS face ids: ${getErrorMessage(error)}`);
  }
  return (data ?? []) as PhotoFace[];
}

/**
 * Look up the indexed face boxes for a photo by its storage path
 * (`photos.original_url`, which is the key the watermark route serves from).
 * Used by the preview pipeline to anchor a watermark badge over a face — the
 * boxes are produced by the existing Rekognition flow, so no AWS call here.
 *
 * Returns `[]` when the photo isn't found or has no faces; callers must treat
 * an empty result as "tile-only preview", never an error.
 */
export async function getPhotoFaceBoxesByStoragePath(
  supabase: SupabaseServerClient,
  storagePath: string,
): Promise<Array<{ boundingBox: Record<string, number>; confidence: number }>> {
  const { data: photo, error: photoError } = await supabase
    .from('photos')
    .select('id')
    .eq('original_url', storagePath)
    .maybeSingle();
  if (photoError) {
    throw new Error(`Failed to look up photo by storage path: ${getErrorMessage(photoError)}`);
  }
  if (!photo) return [];

  const { data, error } = await supabase
    .from('photo_faces')
    .select('bounding_box, confidence')
    .eq('photo_id', photo.id as string);
  if (error) {
    throw new Error(`Failed to get photo faces by storage path: ${getErrorMessage(error)}`);
  }
  return (data ?? [])
    .filter((row) => row.bounding_box)
    .map((row) => ({
      boundingBox: row.bounding_box as Record<string, number>,
      confidence: (row.confidence as number) ?? 0,
    }));
}

/**
 * Service-role only. Clean up every face record for a photo — used when
 * the photographer deletes a photo or disables AI matching on the event.
 * The corresponding AWS-side DeleteFaces call lives in PR 2's worker.
 */
export async function deletePhotoFacesByPhotoId(
  supabase: SupabaseServerClient,
  photoId: string,
): Promise<void> {
  const { error } = await supabase.from('photo_faces').delete().eq('photo_id', photoId);
  if (error) {
    throw new Error(`Failed to delete photo faces: ${getErrorMessage(error)}`);
  }
}

/**
 * Service-role only. Updates the per-photo indexing state. Called by the
 * worker as it walks the photo through `pending → indexing → indexed`
 * (or `no_faces` / `failed`).
 */
export async function updatePhotoFaceIndexStatus(
  supabase: SupabaseServerClient,
  photoId: string,
  status: FaceIndexStatus,
): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .update({ face_index_status: status })
    .eq('id', photoId);
  if (error) {
    throw new Error(`Failed to update photo face_index_status: ${getErrorMessage(error)}`);
  }
}

export interface EventAiIndexingProgress {
  /** Photos eligible for indexing (everything not marked `not_applicable`). */
  totalApplicable: number;
  /** Photos in terminal success states: `indexed` or `no_faces`. */
  indexed: number;
  /** Photos still in `pending` or `indexing`. */
  pending: number;
  /** Photos in `failed` (eligible for re-index). */
  failed: number;
  /** Most recent `photo_faces.indexed_at` for this event; null if none. */
  lastIndexedAt: string | null;
}

/**
 * Aggregate indexing progress for an event — used by the photographer
 * dashboard's AI status card and metadata chip.
 */
export async function getEventAiIndexingProgress(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<EventAiIndexingProgress> {
  const { data: photoRows, error: photosError } = await supabase
    .from('photos')
    .select('id, face_index_status')
    .eq('event_id', eventId)
    .is('deleted_at', null);
  if (photosError) {
    throw new Error(`Failed to load event photos: ${getErrorMessage(photosError)}`);
  }

  let totalApplicable = 0;
  let indexed = 0;
  let pending = 0;
  let failed = 0;
  const photoIds: string[] = [];
  for (const row of photoRows ?? []) {
    photoIds.push(row.id as string);
    const status = row.face_index_status as FaceIndexStatus | null;
    if (!status || status === 'not_applicable') continue;
    totalApplicable += 1;
    if (status === 'indexed' || status === 'no_faces') indexed += 1;
    else if (status === 'failed') failed += 1;
    else pending += 1;
  }

  let lastIndexedAt: string | null = null;
  if (photoIds.length > 0) {
    const { data, error } = await supabase
      .from('photo_faces')
      .select('indexed_at')
      .in('photo_id', photoIds)
      .order('indexed_at', { ascending: false })
      .limit(1);
    if (error) {
      throw new Error(`Failed to load latest face record: ${getErrorMessage(error)}`);
    }
    lastIndexedAt = ((data ?? [])[0]?.indexed_at as string | undefined) ?? null;
  }

  return { totalApplicable, indexed, pending, failed, lastIndexedAt };
}

/**
 * Service-role only. List all photo ids for an event, regardless of status.
 * Used by Inngest workers when fanning out re-index or marking statuses in
 * bulk. Returns ids only — no per-photo metadata is needed at the call site.
 */
export async function listEventPhotoIds(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<string[]> {
  const { data, error } = await supabase.from('photos').select('id').eq('event_id', eventId);
  if (error) {
    throw new Error(`Failed to list event photo ids: ${getErrorMessage(error)}`);
  }
  return (data ?? []).map((row) => row.id as string);
}

/**
 * Service-role only. Bulk-set `face_index_status` for an arbitrary id list.
 * Used by the backfill and disable workers.
 */
export async function bulkSetPhotoFaceIndexStatus(
  supabase: SupabaseServerClient,
  photoIds: string[],
  status: FaceIndexStatus,
): Promise<void> {
  if (photoIds.length === 0) return;
  const { error } = await supabase
    .from('photos')
    .update({ face_index_status: status })
    .in('id', photoIds);
  if (error) {
    throw new Error(`Failed to bulk-set face_index_status: ${getErrorMessage(error)}`);
  }
}

/**
 * Service-role only. Filter an id list to only those in given statuses.
 * Returns nothing (mutation is via `bulkSetPhotoFaceIndexStatus`); callers
 * use this to know which photos to fan out.
 */
export async function listEventPhotosByStatuses(
  supabase: SupabaseServerClient,
  eventId: string,
  statuses: FaceIndexStatus[],
): Promise<Array<{ id: string; storagePath: string | null }>> {
  if (statuses.length === 0) return [];
  const { data, error } = await supabase
    .from('photos')
    .select('id, original_url, face_index_status')
    .eq('event_id', eventId)
    .in('face_index_status', statuses);
  if (error) {
    throw new Error(`Failed to list photos by status: ${getErrorMessage(error)}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    storagePath: (row.original_url as string | null) ?? null,
  }));
}

/**
 * Service-role only. Count photos for an event still in `pending` or
 * `indexing`. Used by `indexPhotoFaces` to decide whether to flip the
 * event status to `'ready'` after persisting its result. Fan-out
 * completion tracker.
 */
export async function countEventPhotosInFlight(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .in('face_index_status', ['pending', 'indexing']);
  if (error) {
    throw new Error(`Failed to count in-flight photos: ${getErrorMessage(error)}`);
  }
  return count ?? 0;
}

/**
 * Service-role only. List events wedged in `ai_matching_status='indexing'`
 * whose `updated_at` is older than `staleBeforeIso`. Used by the reconciliation
 * cron (T-099) to find events that never drained to `ready` (a lost
 * `maybe-mark-event-ready` step, or a `photo.uploaded` fan-out event that was
 * never processed).
 *
 * The `updated_at` gate is deliberate: `events.updated_at` is trigger-maintained
 * (`events_set_updated_at`), so it reflects when the event last entered/changed
 * the `indexing` state. Only events stuck for longer than the staleness window
 * are returned — a re-index in progress just bumped `updated_at` to ~now, so it
 * is never mistaken for stuck and clobbered mid-flight.
 */
export async function listStuckIndexingEvents(
  supabase: SupabaseServerClient,
  staleBeforeIso: string,
  limit: number,
): Promise<Array<{ id: string }>> {
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('ai_matching_status', 'indexing')
    .is('deleted_at', null)
    .lt('updated_at', staleBeforeIso)
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list stuck indexing events: ${getErrorMessage(error)}`);
  }
  return (data ?? []).map((row) => ({ id: row.id as string }));
}

/**
 * Service-role only. Bulk delete all `photo_faces` rows for an event.
 * Used by the disable worker when tearing down a collection.
 */
export async function deletePhotoFacesByEventId(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<void> {
  // Two-step: faces are keyed by photo_id, not event_id. Resolve the ids
  // first, then delete in a single `in` clause.
  const photoIds = await listEventPhotoIds(supabase, eventId);
  if (photoIds.length === 0) return;
  const { error } = await supabase.from('photo_faces').delete().in('photo_id', photoIds);
  if (error) {
    throw new Error(`Failed to delete photo faces by event: ${getErrorMessage(error)}`);
  }
}
