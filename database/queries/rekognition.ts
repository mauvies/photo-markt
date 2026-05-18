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
    .eq('event_id', eventId);
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
