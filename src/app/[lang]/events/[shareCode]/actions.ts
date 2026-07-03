'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { headers } from 'next/headers';
import {
  deletePhoto,
  deleteStorageFiles,
  getEventByShareCode,
  getEventPhotosPublic,
  getPhotoForContributorDelete,
  getPhotoForDownload,
  resolveEventByParam,
  type SupabaseServerClient,
} from '@/database/queries';
import { getEventBibDetectionState, getPhotoIdsByBibInEvent } from '@/database/queries/bib-numbers';
import { getPurchasedPhotoIdsForEvent } from '@/database/queries/orders';
import {
  getEventAiIndexingProgress,
  getEventRekognitionState,
  getPhotoFacesByAwsFaceIds,
} from '@/database/queries/rekognition';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { searchFacesByImage } from '@/lib/aws/face-indexing';
import { prepareImageForRekognition } from '@/lib/aws/image-prep';
import { normalizeBibToken } from '@/lib/bib-numbers';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { validatePhotoUpload } from '@/lib/photo-upload';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { safeCall } from '@/lib/safe-call';
import { BIB_SEARCH_RATE_LIMIT_PREFIX, type SearchPhotosByBibResult } from './bib-search-shared';
import {
  FACE_SEARCH_RATE_LIMIT_PREFIX,
  type SearchFacesInEventResult,
  type SearchMatchBucket,
} from './face-search-shared';

/**
 * Delete a photo on a collaborative event from the public viewer.
 *
 * Authorization:
 *   1. Authenticated event owner → always allowed.
 *   2. Authenticated user who owns the row (photo.user_id) → allowed. This is
 *      the path for authenticated contributors, whose uploads set user_id but
 *      leave uploaded_by null.
 *   3. Authenticated user matching photo.uploaded_by → allowed (guest-uploaded
 *      rows later associated with an account; kept as a fallback).
 *   4. Anonymous guest with a matching deleteToken → allowed.
 *   Else → 403-style error.
 *
 * Uses the service-role client because guests have no auth session and the
 * photos RLS only allows owner deletes. Authorization is enforced explicitly
 * in code instead.
 */
export async function deleteContributorPhotoAction(input: {
  photoId: string;
  shareCode: string;
  deleteToken?: string;
}): Promise<{ success: true }> {
  const { photoId, shareCode, deleteToken } = input;
  if (!photoId || !shareCode) {
    throw new Error('Missing photo or event reference.');
  }

  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;
  const event = await getEventByShareCode(adminClient, shareCode);
  if (!event || !event.is_collaborative) {
    throw new Error('Event not found.');
  }

  const photo = await getPhotoForContributorDelete(adminClient, photoId, event.id);
  if (!photo) {
    throw new Error('Photo not found.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isEventOwner = Boolean(user && user.id === photo.event_owner_id);
  const isAuthedRowOwner = Boolean(user && photo.user_id && user.id === photo.user_id);
  const isAuthedUploader = Boolean(user && photo.uploaded_by && user.id === photo.uploaded_by);
  const isGuestUploader = Boolean(
    !user && deleteToken && photo.delete_token && deleteToken === photo.delete_token,
  );

  if (!isEventOwner && !isAuthedRowOwner && !isAuthedUploader && !isGuestUploader) {
    throw new Error('Not authorized to delete this photo.');
  }

  // Delete via admin client. The user_id arg to deletePhoto is just for the
  // RLS-friendly equality clause; we pass the photo's stored user_id so the
  // delete matches even though we're using the service role.
  await deletePhoto(adminClient, photo.id, photo.user_id);
  if (photo.original_url) {
    try {
      await deleteStorageFiles(adminClient, 'photos', [photo.original_url]);
    } catch (cleanupError) {
      console.error('Storage cleanup failed for contributor delete', cleanupError);
    }
  }

  revalidatePath(`/es/events/${shareCode}`);
  revalidatePath(`/en/events/${shareCode}`);
  revalidatePath(`/es/dashboard/photographer/events/${event.id}`);
  revalidatePath(`/en/dashboard/photographer/events/${event.id}`);
  revalidateTag(`event-${event.id}`, 'max');
  if (event.slug) revalidateTag(`event-${event.slug}`, 'max');
  if (event.share_code) revalidateTag(`event-${event.share_code}`, 'max');

  return { success: true };
}

// ─── Talent face search (PR 3) ────────────────────────────────────────────────

/**
 * Map a SearchFacesByImage similarity score (0–100) to one of the three
 * product-defined confidence buckets. Returns null when the score is below
 * 80, which our AWS call already filters out — defensive null for callers
 * that don't pre-filter.
 */
function bucketForSimilarity(similarity: number): SearchMatchBucket | null {
  if (similarity >= 95) return 'very-likely';
  if (similarity >= 85) return 'likely';
  if (similarity >= 80) return 'possibly';
  return null;
}

/**
 * Talent-side AI face search. Uploads a selfie, runs AWS Rekognition
 * `SearchFacesByImage` against the event's collection, and returns the
 * matched photos bucketed by similarity. Per Model 1, the selfie is NEVER
 * stored — buffer lives only inside this function and is GC'd at exit.
 *
 * Auth model: anonymous-friendly. Rate-limited by `(shareCode, IP)` so an
 * unauthenticated user can't brute-force the collection.
 *
 * Critical defensive rules (proven in the indexer worker debugging cycle):
 *   - Selfie validation goes through `validatePhotoUpload` (Sharp magic-byte
 *     check). NEVER trust client MIME — the upload flow's prior version did,
 *     which the audit flagged as a vuln class.
 *   - AWS / Sharp / Storage calls wrap in `safeCall`. AWS SDK v3 errors
 *     retain `Input.Image.Bytes` (the selfie Buffer) via `cause` /
 *     `$response`; surfacing them unfiltered would (a) blow past Vercel's
 *     serverless response cap and (b) leak biometric data into logs.
 *     `safeCall` discards the original error and re-throws a plain one
 *     carrying ONLY the message string.
 *   - No `console.log` may serialize the selfie buffer. Error paths return
 *     generic localized messages; never echo bytes / base64 anywhere.
 */
export async function searchFacesInEvent(
  shareCode: string,
  selfieFormData: FormData,
): Promise<SearchFacesInEventResult> {
  if (!shareCode) {
    throw new Error('Missing share code.');
  }

  // Server-side defense in depth. The client also gates rendering on
  // `isFeatureEnabled('AI_MATCHING')`, but the SA cannot trust that.
  if (!isFeatureEnabled('AI_MATCHING')) {
    throw new Error('Face search is not enabled.');
  }

  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

  // 1. Resolve the event. The route param may be a UUID, an SEO slug, or a
  //    share code (public-only events have no share code), so use the same
  //    multi-identifier resolution as the public page.
  const event = await resolveEventByParam(adminClient, shareCode);
  if (!event) {
    throw new Error('Event not found.');
  }

  // 2. Verify AI matching is eligible. `containsMinors=true` and missing
  //    `collectionId` are both reasons to refuse without making the AWS call.
  const state = await getEventRekognitionState(adminClient, event.id);
  if (!state || !state.enabled || state.containsMinors || !state.collectionId) {
    throw new Error('This event no longer supports face search.');
  }
  const collectionId = state.collectionId;

  // 3. Rate-limit by (shareCode, IP). 10 per hour matches the spec. Throws a
  //    parseable error so the modal can render the localized copy without
  //    a structured-error class crossing the SA boundary.
  const ip = getClientIp(await headers());
  const rl = await rateLimit({
    key: `face-search:${shareCode}:${ip}`,
    limit: 10,
    windowSec: 3600,
  });
  if (!rl.ok) {
    throw new Error(`${FACE_SEARCH_RATE_LIMIT_PREFIX}:exhausted`);
  }

  // 4. Extract + validate the selfie. validatePhotoUpload runs Sharp's
  //    magic-byte detection; client MIME is ignored. This is the auth-
  //    grade boundary for the byte content.
  const rawFile = selfieFormData.get('selfie');
  if (!(rawFile instanceof File) || rawFile.size === 0) {
    throw new Error('No selfie provided.');
  }
  if (rawFile.size > 10 * 1024 * 1024) {
    throw new Error('Selfie is too large. Maximum size is 10 MB.');
  }

  let validated: Awaited<ReturnType<typeof validatePhotoUpload>>;
  try {
    validated = await validatePhotoUpload(rawFile);
  } catch {
    // Don't bubble Sharp's message through — it may contain implementation
    // details. The modal renders a generic localized error.
    throw new Error('The uploaded file is not a valid image.');
  }

  // 5. Downscale for AWS. The 5 MB IndexFaces / SearchFacesByImage cap
  //    is enforced server-side by AWS; this gets us well under that.
  //    Both calls are wrapped in safeCall so the selfie Buffer never
  //    appears in a thrown error's metadata chain.
  let preppedBytes: Buffer;
  try {
    preppedBytes = await safeCall('prepare-selfie', () =>
      prepareImageForRekognition(validated.buffer),
    );
  } catch {
    // Sharp/prepare errors after validation pass are extremely rare. Return
    // generic message — the modal shows "search failed" and lets the user
    // retry.
    throw new Error('Could not process the selfie. Please try a different photo.');
  }

  // 6. Call AWS SearchFacesByImage. Handle the two product-relevant AWS
  //    error shapes inline so the modal can render specific copy:
  //      - InvalidParameterException → 0 or 2+ faces in the selfie
  //      - ResourceNotFoundException → collection deleted mid-search
  //    Anything else falls through to a generic "search failed" error.
  let awsMatches: Awaited<ReturnType<typeof searchFacesByImage>>;
  try {
    awsMatches = await safeCall('search-faces', () =>
      searchFacesByImage({
        collectionId,
        selfieBytes: preppedBytes,
        threshold: 80,
      }),
    );
  } catch (err) {
    const errorName = err instanceof Error ? err.name : '';
    if (errorName === 'InvalidParameterException') {
      const progress = await getEventAiIndexingProgress(adminClient, event.id);
      return {
        matches: [],
        totalSearched: progress.totalApplicable,
        eventIndexingComplete: progress.pending === 0,
        reason: 'invalid-selfie',
      };
    }
    if (errorName === 'ResourceNotFoundException') {
      return {
        matches: [],
        totalSearched: 0,
        eventIndexingComplete: true,
        reason: 'collection-missing',
      };
    }
    throw new Error('Search failed. Please try again.');
  }

  // 7. Map AWS face IDs → our photo IDs. `getPhotoFacesByAwsFaceIds` returns
  //    `photo_faces` rows. We dedupe in-memory by `photo_id` keeping the
  //    highest similarity (a single photo may surface multiple faces if the
  //    talent is in a group shot).
  if (awsMatches.length === 0) {
    const progress = await getEventAiIndexingProgress(adminClient, event.id);
    return {
      matches: [],
      totalSearched: progress.totalApplicable,
      eventIndexingComplete: progress.pending === 0,
    };
  }

  const similarityByAwsFaceId = new Map<string, number>();
  for (const m of awsMatches) {
    const prev = similarityByAwsFaceId.get(m.awsFaceId);
    if (prev === undefined || m.similarity > prev) {
      similarityByAwsFaceId.set(m.awsFaceId, m.similarity);
    }
  }
  const photoFaceRows = await getPhotoFacesByAwsFaceIds(
    adminClient,
    Array.from(similarityByAwsFaceId.keys()),
  );

  const bestSimilarityByPhotoId = new Map<string, number>();
  for (const row of photoFaceRows) {
    const awsSimilarity = similarityByAwsFaceId.get(row.aws_face_id);
    if (awsSimilarity === undefined) continue;
    const prev = bestSimilarityByPhotoId.get(row.photo_id);
    if (prev === undefined || awsSimilarity > prev) {
      bestSimilarityByPhotoId.set(row.photo_id, awsSimilarity);
    }
  }

  // 8. Cross-reference matched photos against the public photo set so
  //    deleted / unapproved / contains-minors photos never leak through
  //    the AI search path.
  const publicPhotos = await getEventPhotosPublic(adminClient, event.id);
  const publicPhotoIds = new Set(publicPhotos.map((p) => p.id));

  const matches: SearchFacesInEventResult['matches'] = [];
  for (const [photoId, similarity] of bestSimilarityByPhotoId) {
    if (!publicPhotoIds.has(photoId)) continue;
    const bucket = bucketForSimilarity(similarity);
    if (!bucket) continue;
    matches.push({ photoId, similarity, bucket });
  }

  // 9. Compute indexing-completeness so the UI can hint that more matches
  //    may appear later when indexing completes.
  const progress = await getEventAiIndexingProgress(adminClient, event.id);

  return {
    matches,
    totalSearched: progress.totalApplicable,
    eventIndexingComplete: progress.pending === 0,
  };
}

// ─── BIB number search (T-032) ───────────────────────────────────────────────

/**
 * Search an event's gallery by bib number. Anonymous-friendly (mirrors face
 * search): resolves the event by share code, requires bib detection to be
 * enabled, rate-limits by `(shareCode, IP)`, and returns the matching PUBLIC
 * photo ids (cross-referenced against the public photo set so unapproved /
 * deleted / minors photos never leak). It's a DB lookup — no AWS call.
 */
export async function searchPhotosByBibInEvent(
  shareCode: string,
  bib: string,
): Promise<SearchPhotosByBibResult> {
  if (!shareCode) throw new Error('Missing share code.');

  const normalized = normalizeBibToken(bib ?? '');
  if (!normalized) return { photoIds: [] };

  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

  // The route param may be a UUID, an SEO slug, or a share code (public-only
  // events have no share code), so resolve it the same way the public page does.
  const event = await resolveEventByParam(adminClient, shareCode);
  if (!event) throw new Error('Event not found.');

  const state = await getEventBibDetectionState(adminClient, event.id);
  if (!state || !state.enabled || state.containsMinors) {
    throw new Error('This event does not support bib search.');
  }

  const ip = getClientIp(await headers());
  const rl = await rateLimit({ key: `bib-search:${shareCode}:${ip}`, limit: 30, windowSec: 3600 });
  if (!rl.ok) {
    throw new Error(`${BIB_SEARCH_RATE_LIMIT_PREFIX}:exhausted`);
  }

  const matchedIds = await getPhotoIdsByBibInEvent(adminClient, event.id, normalized);
  if (matchedIds.length === 0) return { photoIds: [] };

  // Cross-reference against the public photo set so unapproved / deleted /
  // minors photos never leak through bib search.
  const publicPhotos = await getEventPhotosPublic(adminClient, event.id);
  const publicIds = new Set(publicPhotos.map((p) => p.id));
  return { photoIds: matchedIds.filter((id) => publicIds.has(id)) };
}

// ─── Single-photo download ────────────────────────────────────────────────────

/**
 * Returns a short-lived signed URL for downloading one event photo's ORIGINAL
 * file from the public event page. Permission is enforced here, server-side,
 * and never trusted from the client:
 *   - the event owner may download any photo of their event;
 *   - on a free event (`price_per_photo === null`) anyone with the link may
 *     download — collaborative free photos are free by design;
 *   - on a paid event, only a signed-in viewer who purchased that photo.
 * The signed URL carries `Content-Disposition: attachment` so the browser
 * saves the original file (never the watermarked preview).
 */
export async function getEventPhotoDownloadUrlAction(
  photoId: string,
  eventId: string,
): Promise<string> {
  if (!photoId || !eventId) {
    throw new Error('Missing photo or event reference.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Rate-limit by viewer (user id, else client IP) — mirrors the bulk route.
  const ip = getClientIp(await headers());
  const rl = await rateLimit({
    key: `photo-download:${user?.id ?? ip}`,
    limit: 60,
    windowSec: 3600,
  });
  if (!rl.ok) {
    throw new Error('Too many download requests. Please try again later.');
  }

  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;
  const photo = await getPhotoForDownload(adminClient, photoId, eventId);
  if (!photo || !photo.original_url) {
    throw new Error('Photo not found.');
  }

  // ── Permission (authoritative) ─────────────────────────────────────────
  const isOwner = Boolean(user && user.id === photo.event_owner_id);
  const isFree = photo.price_per_photo === null;
  let allowed = isOwner || isFree;
  if (!allowed && user) {
    const purchased = await getPurchasedPhotoIdsForEvent(adminClient, user.id, eventId);
    allowed = purchased.has(photoId);
  }
  if (!allowed) {
    throw new Error('You do not have permission to download this photo.');
  }

  // Sign the ORIGINAL path with a filename so the browser saves it as an
  // attachment. Fall back to the storage-path basename when the user-supplied
  // filename is absent (older rows pre-date the `original_filename` column).
  const filename = photo.original_filename ?? photo.original_url.split('/').pop() ?? 'photo.jpg';
  const { data, error } = await supabaseAdmin.storage
    .from('photos')
    .createSignedUrl(photo.original_url, 300, { download: filename });
  if (error || !data?.signedUrl) {
    throw new Error('Could not prepare the download.');
  }
  return data.signedUrl;
}
