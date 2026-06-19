'use server';

import { revalidatePath } from 'next/cache';
import { userHasRole } from '@/app/[lang]/actions/roles';
import { claimPhotoForTalent } from '@/database/queries/talent-library';
import {
  tagPhotoForTalent,
  tagPhotosForTalent,
  untagPhotoForTalent,
} from '@/database/queries/talent-photo-tags';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';

/**
 * Add a photo to "My Photos" (tag it for the current talent user)
 */
export async function addPhotoToMyPhotosAction(photoId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to add photos to your library.');
  }

  // Verify user is talent
  if (!(await userHasRole('talent'))) {
    throw new Error('Only talent users can add photos to their library.');
  }

  // Tag the photo for the current user (tagged by themselves)
  await tagPhotoForTalent(supabase, photoId, user.id, user.id);
  revalidatePath('/es/dashboard/talent/events/[id]', 'page');
  revalidatePath('/en/dashboard/talent/events/[id]', 'page');
  revalidatePath('/es/dashboard/talent/favorites', 'page');
  revalidatePath('/en/dashboard/talent/favorites', 'page');
}

/**
 * Remove a photo from "My Photos" (untag it for the current talent user)
 */
export async function removePhotoFromMyPhotosAction(photoId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to remove photos from your library.');
  }

  // Verify user is talent
  if (!(await userHasRole('talent'))) {
    throw new Error('Only talent users can remove photos from their library.');
  }

  // Untag the photo for the current user
  await untagPhotoForTalent(supabase, photoId, user.id);
  revalidatePath('/es/dashboard/talent/events/[id]', 'page');
  revalidatePath('/en/dashboard/talent/events/[id]', 'page');
  revalidatePath('/es/dashboard/talent/favorites', 'page');
  revalidatePath('/en/dashboard/talent/favorites', 'page');
}

/**
 * Claim a FREE photo into the talent's profile (acquired/owned photos) — the
 * same collection purchased photos land in. Distinct from "My Photos"
 * favorites. Add-only; a repeat claim is a no-op. The free-event check is
 * authoritative and server-side — a paid photo can never be claimed for free.
 */
export async function addPhotoToProfileAction(photoId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to add photos to your profile.');
  }

  if (!(await userHasRole('talent'))) {
    throw new Error('Only talent users can add photos to their profile.');
  }

  // Authoritative free-event check — only free photos can be claimed.
  const { data: photo } = await supabaseAdmin
    .from('photos')
    .select('id, events!inner(price_per_photo)')
    .eq('id', photoId)
    .maybeSingle();
  if (!photo) {
    throw new Error('Photo not found.');
  }
  const event = Array.isArray(photo.events) ? photo.events[0] : photo.events;
  if (!event || event.price_per_photo !== null) {
    throw new Error('Only free photos can be added to your profile.');
  }

  await claimPhotoForTalent(supabase, photoId, user.id);
  revalidatePath('/es/dashboard/talent/events/[id]', 'page');
  revalidatePath('/en/dashboard/talent/events/[id]', 'page');
  revalidatePath('/es/dashboard/talent/profile', 'page');
  revalidatePath('/en/dashboard/talent/profile', 'page');
}

/**
 * Bulk "Add to favorites" — tags every selected photo for the current talent
 * (idempotent upsert). Used by the selection action bar.
 */
export async function addPhotosToMyPhotosAction(photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to add photos to your library.');
  }

  if (!(await userHasRole('talent'))) {
    throw new Error('Only talent users can add photos to their library.');
  }

  await tagPhotosForTalent(supabase, photoIds, user.id, user.id);
  revalidatePath('/es/dashboard/talent/events/[id]', 'page');
  revalidatePath('/en/dashboard/talent/events/[id]', 'page');
  revalidatePath('/es/dashboard/talent/favorites', 'page');
  revalidatePath('/en/dashboard/talent/favorites', 'page');
}

/**
 * Bulk "Add to my profile" — claims every selected FREE photo into the
 * talent's owned collection. Paid photos in the selection are skipped (the
 * free-event check is authoritative and server-side); the returned counts
 * let the caller surface a clear "added N / skipped M" toast.
 */
export async function addPhotosToProfileAction(
  photoIds: string[],
): Promise<{ claimed: number; skipped: number }> {
  if (photoIds.length === 0) return { claimed: 0, skipped: 0 };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to add photos to your profile.');
  }

  if (!(await userHasRole('talent'))) {
    throw new Error('Only talent users can add photos to their profile.');
  }

  // Authoritative free-event check — only free photos can be claimed.
  const { data: photos } = await supabaseAdmin
    .from('photos')
    .select('id, events!inner(price_per_photo)')
    .in('id', photoIds);
  const freeIds = (photos ?? [])
    .filter((p) => {
      const event = Array.isArray(p.events) ? p.events[0] : p.events;
      return event != null && event.price_per_photo === null;
    })
    .map((p) => p.id as string);

  for (const id of freeIds) {
    await claimPhotoForTalent(supabase, id, user.id);
  }

  revalidatePath('/es/dashboard/talent/events/[id]', 'page');
  revalidatePath('/en/dashboard/talent/events/[id]', 'page');
  revalidatePath('/es/dashboard/talent/profile', 'page');
  revalidatePath('/en/dashboard/talent/profile', 'page');

  return { claimed: freeIds.length, skipped: photoIds.length - freeIds.length };
}
