'use server';

import { revalidatePath } from 'next/cache';
import { getActiveRole } from '@/app/[lang]/actions/roles';
import { claimPhotoForTalent } from '@/database/queries/talent-library';
import { tagPhotoForTalent, untagPhotoForTalent } from '@/database/queries/talent-photo-tags';
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
  const { activeRole } = await getActiveRole();
  if (activeRole !== 'talent') {
    throw new Error('Only talent users can add photos to their library.');
  }

  // Tag the photo for the current user (tagged by themselves)
  await tagPhotoForTalent(supabase, photoId, user.id, user.id);
  revalidatePath('/es/dashboard/talent/events/[id]', 'page');
  revalidatePath('/en/dashboard/talent/events/[id]', 'page');
  revalidatePath('/es/dashboard/talent/photos', 'page');
  revalidatePath('/en/dashboard/talent/photos', 'page');
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
  const { activeRole } = await getActiveRole();
  if (activeRole !== 'talent') {
    throw new Error('Only talent users can remove photos from their library.');
  }

  // Untag the photo for the current user
  await untagPhotoForTalent(supabase, photoId, user.id);
  revalidatePath('/es/dashboard/talent/events/[id]', 'page');
  revalidatePath('/en/dashboard/talent/events/[id]', 'page');
  revalidatePath('/es/dashboard/talent/photos', 'page');
  revalidatePath('/en/dashboard/talent/photos', 'page');
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

  const { activeRole } = await getActiveRole();
  if (activeRole !== 'talent') {
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
