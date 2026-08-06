'use client';

import {
  attachEventCoverAction,
  createEventCoverUploadUrlAction,
} from '@/app/[lang]/dashboard/photographer/events/new/actions';
import { MAX_PHOTO_BYTES } from '@/lib/upload-limits';

/**
 * Client half of the event-cover upload (T-238). Shared by the create wizard and
 * the edit form so the two can't drift on the sequence — mint → PUT → attach —
 * exactly as `usePhotoUpload` shares it for photos.
 *
 * The bytes go **straight to Supabase Storage**, never through a Server Action:
 * Vercel rejects any function request body over 4.5 MB with its own 413 before our
 * code runs, so the previous `FormData` upload could not even show a toast (see
 * `upload-limits.ts`). No progress reporting here — a cover is one file, and the
 * form already shows a busy state.
 */

/** `too-large` is the only failure with copy of its own — every other cause (storage
 *  refused the PUT, the bytes weren't an image, the row write failed) is one generic
 *  `failed`, because a thrown Server Action message is redacted in production and
 *  cannot be told apart client-side anyway. */
export type CoverUploadErrorCode = 'too-large' | 'failed';

export class CoverUploadError extends Error {
  readonly code: CoverUploadErrorCode;

  constructor(code: CoverUploadErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CoverUploadError';
    this.code = code;
  }
}

/** Cap the browser enforces before uploading, so an oversized pick fails as OUR
 *  error with OUR copy. Identical to the server-side per-file photo cap — the cover
 *  path is direct-to-Storage, so this is the only limit in play. */
export const MAX_COVER_BYTES = MAX_PHOTO_BYTES;

export async function uploadEventCover(eventId: string, file: File): Promise<void> {
  if (file.size > MAX_COVER_BYTES) {
    throw new CoverUploadError('too-large');
  }

  const { path, signedUrl } = await createEventCoverUploadUrlAction(eventId, file.name);

  const response = await fetch(signedUrl, {
    method: 'PUT',
    body: file,
    // Client-declared type only labels the stored object; the server re-derives the
    // real format from the bytes in `attachEventCoverAction` and throws the object
    // away when they aren't an image.
    headers: file.type ? { 'Content-Type': file.type } : undefined,
  });
  if (!response.ok) {
    throw new CoverUploadError('failed', `Storage rejected the cover (HTTP ${response.status})`);
  }

  try {
    await attachEventCoverAction(eventId, path);
  } catch (err) {
    // The object is already uploaded; a rejection here means it failed validation
    // (the action deletes it) or the row write failed (the orphan-cleanup cron
    // sweeps it within 30 min). Either way the caller just needs a reason to show.
    throw new CoverUploadError('failed', err instanceof Error ? err.message : undefined);
  }
}
