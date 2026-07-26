'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { getProfileFields, updateProfile } from '@/database/queries/profiles';
import { deleteStorageFiles, uploadFile } from '@/database/queries/storage';
import type { SupabaseServerClient } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import {
  AVATAR_BUCKET,
  avatarObjectPathToDelete,
  buildAvatarPath,
  resizeAvatar,
  validateAvatarUpload,
} from '@/lib/avatar-upload';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

/** Upload throttle — authenticated but still an abuse/cost surface. */
const AVATAR_RATELIMIT_MAX = 20;
const AVATAR_RATELIMIT_WINDOW_SEC = 3600;

/**
 * Machine-readable failure codes the client maps to localized copy. Returning a
 * discriminated result (instead of throwing) keeps the reason intact across the
 * Server Action boundary — thrown error messages are redacted in production.
 */
export type AvatarErrorCode =
  | 'not-authenticated'
  | 'invalid-type'
  | 'too-large'
  | 'rate-limit'
  | 'generic';

export type AvatarActionResult =
  | { ok: true; avatarUrl: string | null }
  | { ok: false; error: AvatarErrorCode };

/** Push the new avatar (or its removal) to every surface that shows it. */
async function revalidateAvatarSurfaces(slug: string | null): Promise<void> {
  revalidatePath('/es/dashboard/photographer/settings/profile');
  revalidatePath('/en/dashboard/photographer/settings/profile');
  revalidatePath('/es/dashboard/talent/settings/profile');
  revalidatePath('/en/dashboard/talent/settings/profile');
  // Public photographer profile (its OG image + header avatar) is cached by slug.
  if (slug) revalidateTag(`photographer-${slug}`, 'max');
  // Event cards on explore/listings render the photographer's avatar.
  revalidateTag('events-public', 'max');
  revalidateTag('top-events', 'max');
}

/**
 * Best-effort sync of the auth `user_metadata.avatar_url` so the public-site
 * header (which reads auth metadata) reflects the change immediately. Non-fatal:
 * `updateUserById` returns `{ error }` rather than throwing, and this app's
 * durable render path reads `profiles.avatar_url`, so a metadata failure only
 * costs the header a refresh, never data integrity. Logged, never surfaced.
 */
async function syncAuthAvatarMetadata(userId: string, avatarUrl: string | null): Promise<void> {
  try {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { avatar_url: avatarUrl },
    });
    if (error) console.error('[avatar] auth metadata sync failed', error);
  } catch (err) {
    console.error('[avatar] auth metadata sync threw', err);
  }
}

/**
 * Persist a new avatar for the current user (both roles share this).
 *
 * Flow: auth → validate magic bytes + size (server-side, never trusts the client
 * MIME) → throttle → read the prior avatar/slug → re-encode to a square WebP →
 * upload to the public `avatars` bucket under `<userId>/…` via the service-role
 * client → write `profiles.avatar_url` (the DURABLE source of truth: public
 * profile + event cards, AND the dashboard chrome via the layouts) → best-effort
 * sync auth `user_metadata.avatar_url` for the public-site header → delete the
 * previous object (delete-on-replace, scoped to the user's folder) → revalidate.
 *
 * `profiles.avatar_url` is the single authoritative write. The auth-metadata sync
 * is best-effort and non-fatal because it is fragile for this Google-OAuth-only
 * app — GoTrue re-syncs `user_metadata.avatar_url` from the Google identity on
 * the next sign-in, so it can revert; the durable render path never depends on
 * it. Validation runs BEFORE the throttle so mistaken picks (wrong type / too
 * big) don't burn the hourly quota. The profile read runs BEFORE the upload so a
 * read error can't orphan a freshly-uploaded object.
 */
export async function updateAvatarAction(formData: FormData): Promise<AvatarActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not-authenticated' };

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'generic' };
  }

  // Validate the raw bytes, then re-encode to a square WebP. A validation throw
  // is a rejected upload (non-image / unsupported / oversized) — map it to a
  // code, never a 500. Done before the throttle so a bad pick costs no quota.
  let webp: Buffer;
  try {
    const validated = await validateAvatarUpload(file);
    webp = await resizeAvatar(validated.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    return { ok: false, error: message.includes('too large') ? 'too-large' : 'invalid-type' };
  }

  const { rateLimit } = await import('@/lib/rate-limit');
  const rl = await rateLimit({
    key: `avatar-upload:${user.id}`,
    limit: AVATAR_RATELIMIT_MAX,
    windowSec: AVATAR_RATELIMIT_WINDOW_SEC,
  });
  if (!rl.ok) return { ok: false, error: 'rate-limit' };

  // Read the prior avatar + slug BEFORE the upload — so a read failure can't
  // orphan a just-uploaded object — for delete-on-replace + cache targeting.
  let previousUrl: string | null;
  let slug: string | null;
  try {
    const current = await getProfileFields(adminClient, user.id, ['avatar_url', 'slug']);
    previousUrl = (current?.avatar_url as string | null | undefined) ?? null;
    slug = (current?.slug as string | null | undefined) ?? null;
  } catch (err) {
    console.error('[updateAvatarAction] profile read failed', err);
    return { ok: false, error: 'generic' };
  }

  const path = buildAvatarPath(user.id);
  try {
    await uploadFile(adminClient, AVATAR_BUCKET, path, webp, {
      contentType: 'image/webp',
      upsert: false,
    });
  } catch (err) {
    console.error('[updateAvatarAction] upload failed', err);
    return { ok: false, error: 'generic' };
  }

  const publicUrl = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;

  // Authoritative write. If it fails, delete the just-uploaded object so it
  // doesn't orphan, and report failure — nothing else was mutated yet.
  try {
    await updateProfile(adminClient, user.id, { avatar_url: publicUrl });
  } catch (err) {
    console.error('[updateAvatarAction] profile write failed', err);
    await deleteStorageFiles(adminClient, AVATAR_BUCKET, [path]).catch(() => {});
    return { ok: false, error: 'generic' };
  }

  // Best-effort auth-metadata sync for the public-site header (see the doc note).
  await syncAuthAvatarMetadata(user.id, publicUrl);

  // Delete-on-replace: only removes the prior object when it's ours and in this
  // user's folder (Google OAuth URLs and foreign paths return null).
  const oldPath = avatarObjectPathToDelete(previousUrl, user.id);
  if (oldPath && oldPath !== path) {
    await deleteStorageFiles(adminClient, AVATAR_BUCKET, [oldPath]).catch((err) => {
      console.error('[updateAvatarAction] old-avatar cleanup failed', err);
    });
  }

  await revalidateAvatarSurfaces(slug);
  return { ok: true, avatarUrl: publicUrl };
}

/**
 * Remove the current user's avatar: clear `profiles.avatar_url` (authoritative —
 * public profile, event cards, and the dashboard chrome all fall back to the
 * `<AvatarFallback>` initials), best-effort clear the auth metadata, and delete
 * the stored object when it's one we own. Same ordering discipline as
 * {@link updateAvatarAction}: the durable write commits first; metadata + object
 * cleanup are non-fatal follow-ups so a partial failure never leaves the profile
 * inconsistent.
 */
export async function removeAvatarAction(): Promise<AvatarActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not-authenticated' };

  let previousUrl: string | null;
  let slug: string | null;
  try {
    const current = await getProfileFields(adminClient, user.id, ['avatar_url', 'slug']);
    previousUrl = (current?.avatar_url as string | null | undefined) ?? null;
    slug = (current?.slug as string | null | undefined) ?? null;
  } catch (err) {
    console.error('[removeAvatarAction] profile read failed', err);
    return { ok: false, error: 'generic' };
  }

  try {
    await updateProfile(adminClient, user.id, { avatar_url: null });
  } catch (err) {
    console.error('[removeAvatarAction] profile write failed', err);
    return { ok: false, error: 'generic' };
  }

  await syncAuthAvatarMetadata(user.id, null);

  const oldPath = avatarObjectPathToDelete(previousUrl, user.id);
  if (oldPath) {
    await deleteStorageFiles(adminClient, AVATAR_BUCKET, [oldPath]).catch((err) => {
      console.error('[removeAvatarAction] object cleanup failed', err);
    });
  }

  await revalidateAvatarSurfaces(slug);
  return { ok: true, avatarUrl: null };
}
