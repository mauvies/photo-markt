/**
 * BIB-number database queries.
 *
 * Pure DB I/O — no AWS SDK imports (the DetectText client lives in
 * `lib/aws/bib-detection.ts`). Mirrors `rekognition.ts`:
 *   - per-event opt-in + status (on the `events` table)
 *   - per-photo bib records (on the `photo_bib_numbers` table)
 *   - per-photo detection state (on the `photos` table)
 *
 * Service-role-only functions are flagged in their docstring — they expect
 * `supabaseAdmin` because writes happen from the Inngest worker, which has no
 * user session. The talent search read goes through the user/anon client and
 * is gated by `photo_bib_numbers`' RLS read policy.
 */

import {
  type BibDetectionProgress,
  summarizeBibDetectionProgress,
} from '@/lib/bib-detection-status';
import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export type BibDetectionStatus =
  | 'pending'
  | 'detecting'
  | 'detected'
  | 'no_bibs'
  | 'failed'
  | 'not_applicable';

export type BibDetectionEventStatus = 'idle' | 'detecting' | 'ready' | 'failed';

export interface EventBibDetectionState {
  enabled: boolean;
  status: BibDetectionEventStatus;
  containsMinors: boolean;
}

export interface PhotoBibInput {
  bibText: string;
  confidence: number;
  boundingBox?: Record<string, number> | null;
}

/**
 * Read the bib-detection state for an event. Returns null if the event does
 * not exist or has been soft-deleted.
 */
export async function getEventBibDetectionState(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<EventBibDetectionState | null> {
  const { data, error } = await supabase
    .from('events')
    .select('bib_detection_enabled, bib_detection_status, contains_minors, deleted_at')
    .eq('id', eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get event bib-detection state: ${getErrorMessage(error)}`);
  }
  if (!data || data.deleted_at) return null;

  return {
    enabled: Boolean(data.bib_detection_enabled),
    status: (data.bib_detection_status as BibDetectionEventStatus) ?? 'idle',
    containsMinors: Boolean(data.contains_minors),
  };
}

/**
 * Patch the event-level bib-detection columns. Callers are responsible for
 * ownership checks before invoking this.
 */
export async function updateEventBibDetectionState(
  supabase: SupabaseServerClient,
  eventId: string,
  partial: { enabled?: boolean; status?: BibDetectionEventStatus },
): Promise<void> {
  const updateData: Record<string, unknown> = {};
  if (partial.enabled !== undefined) updateData.bib_detection_enabled = partial.enabled;
  if (partial.status !== undefined) updateData.bib_detection_status = partial.status;
  if (Object.keys(updateData).length === 0) return;

  const { error } = await supabase.from('events').update(updateData).eq('id', eventId);
  if (error) {
    throw new Error(`Failed to update event bib-detection state: ${getErrorMessage(error)}`);
  }
}

/**
 * Service-role only. Persist the filtered bib tokens for a photo. Idempotent:
 * the unique `(photo_id, bib_text)` constraint + `ignoreDuplicates` make a
 * retry a no-op rather than an error.
 */
export async function persistPhotoBibs(
  supabase: SupabaseServerClient,
  photoId: string,
  bibs: PhotoBibInput[],
): Promise<void> {
  if (bibs.length === 0) return;
  const { error } = await supabase.from('photo_bib_numbers').upsert(
    bibs.map((bib) => ({
      photo_id: photoId,
      bib_text: bib.bibText,
      confidence: bib.confidence,
      bounding_box: bib.boundingBox ?? null,
    })),
    { onConflict: 'photo_id,bib_text', ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(`Failed to persist photo bibs: ${getErrorMessage(error)}`);
  }
}

/**
 * Service-role only. Update the per-photo bib-detection state as the worker
 * walks the photo through `pending → detecting → detected` (or `no_bibs` /
 * `failed` / `not_applicable`).
 */
export async function updatePhotoBibDetectionStatus(
  supabase: SupabaseServerClient,
  photoId: string,
  status: BibDetectionStatus,
): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .update({ bib_detection_status: status })
    .eq('id', photoId);
  if (error) {
    throw new Error(`Failed to update photo bib_detection_status: ${getErrorMessage(error)}`);
  }
}

/**
 * Service-role only. Read a single photo's current `bib_detection_status`.
 * Used by the worker to skip a redundant `DetectText` call when a photo was
 * already detected and `photo.uploaded` re-fires for an unrelated reason
 * (e.g. a face-indexing re-index backfill).
 */
export async function getPhotoBibDetectionStatus(
  supabase: SupabaseServerClient,
  photoId: string,
): Promise<BibDetectionStatus | null> {
  const { data, error } = await supabase
    .from('photos')
    .select('bib_detection_status')
    .eq('id', photoId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to get photo bib_detection_status: ${getErrorMessage(error)}`);
  }
  return (data?.bib_detection_status as BibDetectionStatus | null) ?? null;
}

/**
 * Service-role only. Bulk-set `bib_detection_status` for an id list — used by
 * the backfill (set `pending`) and the in-flight tracker.
 */
export async function bulkSetPhotoBibDetectionStatus(
  supabase: SupabaseServerClient,
  photoIds: string[],
  status: BibDetectionStatus,
): Promise<void> {
  if (photoIds.length === 0) return;
  const { error } = await supabase
    .from('photos')
    .update({ bib_detection_status: status })
    .in('id', photoIds);
  if (error) {
    throw new Error(`Failed to bulk-set bib_detection_status: ${getErrorMessage(error)}`);
  }
}

/**
 * Aggregate bib-detection progress for an event's photos — processed vs total,
 * in-flight, failed, and how many carry bib numbers. Mirrors
 * `getEventAiIndexingProgress`; the counting itself is the pure
 * `summarizeBibDetectionProgress` so it stays unit-testable (T-139). Backs the
 * owner's status card + its polling action.
 */
export async function getEventBibDetectionProgress(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<BibDetectionProgress> {
  const { data, error } = await supabase
    .from('photos')
    .select('bib_detection_status')
    .eq('event_id', eventId)
    .is('deleted_at', null);
  if (error) {
    throw new Error(`Failed to load event bib-detection progress: ${getErrorMessage(error)}`);
  }
  return summarizeBibDetectionProgress(
    (data ?? []).map((row) => (row.bib_detection_status as BibDetectionStatus | null) ?? null),
  );
}

/**
 * Service-role only. Count photos for an event still in `pending`/`detecting`.
 * Used by the worker to decide when to flip the event status to `ready`.
 */
export async function countEventPhotosBibInFlight(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .in('bib_detection_status', ['pending', 'detecting']);
  if (error) {
    throw new Error(`Failed to count in-flight bib photos: ${getErrorMessage(error)}`);
  }
  return count ?? 0;
}

/**
 * Service-role only. List an event's photos that still need bib detection
 * (never run, or a prior failure) with their storage path — the backfill
 * fan-out set when an owner enables detection on a populated event. Photos
 * already `detected`/`no_bibs` are skipped so re-enabling doesn't re-spend on
 * AWS.
 */
export async function listEventPhotosForBibDetection(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<Array<{ id: string; storagePath: string | null }>> {
  const { data, error } = await supabase
    .from('photos')
    .select('id, original_url, bib_detection_status')
    .eq('event_id', eventId)
    .or('bib_detection_status.is.null,bib_detection_status.eq.failed');
  if (error) {
    throw new Error(`Failed to list photos for bib detection: ${getErrorMessage(error)}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    storagePath: (row.original_url as string | null) ?? null,
  }));
}

/**
 * Talent search: photo ids in an event whose detected bib matches `bibText`
 * exactly (normalized). Scoped to the event; the caller intersects with the
 * gallery's already visibility-filtered photo set (and `photo_bib_numbers`'
 * RLS read policy gates direct reads).
 */
export async function getPhotoIdsByBibInEvent(
  supabase: SupabaseServerClient,
  eventId: string,
  bibText: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('photo_bib_numbers')
    .select('photo_id, photos!inner(event_id)')
    .eq('bib_text', bibText)
    .eq('photos.event_id', eventId);
  if (error) {
    throw new Error(`Failed to search photos by bib: ${getErrorMessage(error)}`);
  }
  return [...new Set((data ?? []).map((row) => row.photo_id as string))];
}

/**
 * Whether the event has ANY detected bib numbers yet. Lets the UI tell apart
 * "detection hasn't produced results (still processing / found nothing)" from
 * "this specific bib didn't match" in the empty state (T-069). Cheap existence
 * probe — selects a single row.
 */
export async function eventHasAnyBibNumbers(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('photo_bib_numbers')
    .select('photo_id, photos!inner(event_id)')
    .eq('photos.event_id', eventId)
    .limit(1);
  if (error) {
    throw new Error(`Failed to check event bib numbers: ${getErrorMessage(error)}`);
  }
  return (data ?? []).length > 0;
}
