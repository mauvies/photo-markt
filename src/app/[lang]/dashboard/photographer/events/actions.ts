'use server';

import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import {
  deleteEvent,
  deleteEventPhotos,
  deleteStorageFiles,
  getEvent,
  getEventCoverPath,
  getPhotoStoragePaths,
  getSoldPhotoIdsForEvent,
  softDeletePhotosByIds,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { inngest } from '@/lib/inngest/client';

/**
 * Soft-delete an event along with all its photos from storage and the database.
 */
export const deleteEventAction = async (eventId: string) => {
  if (!eventId) {
    throw new Error('Event id is required.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to delete an event.');
  }

  // Fetch the event before deleting so we know which cache entries on the
  // public route to invalidate. /events/[param] caches under tag
  // `event-{param}` where param can be the UUID, the slug, or the share code
  // — invalidating only `event-{eventId}` leaves stale entries served via the
  // other identifiers.
  const event = await getEvent(supabase, eventId, user.id);
  if (!event) {
    throw new Error('Event not found.');
  }

  // Purchased photos back real sales (order_items / guest_order_items are
  // ON DELETE RESTRICT) — keep their rows AND their storage so the order
  // history stays intact and buyers keep download access. Checked with the
  // admin client because order tables are RLS-scoped to the buyer.
  const purchasedPhotoIds = await getSoldPhotoIdsForEvent(supabaseAdmin, eventId);

  // Get storage paths before deleting photos (excluding purchased ones)
  const storagePaths = await getPhotoStoragePaths(supabase, eventId, user.id, purchasedPhotoIds);

  // The dedicated cover image (T-055) has no `photos` row, so it isn't in
  // storagePaths — remove it explicitly or it lingers in storage forever.
  const coverPath = await getEventCoverPath(supabase, eventId);

  // Delete photos from database (excluding purchased ones)
  await deleteEventPhotos(supabase, eventId, user.id, purchasedPhotoIds);

  // T-142: soft-delete the retained sold photos so they carry a uniform
  // `deleted_at` state (hidden from every gallery/search/cart the same way an
  // individually-deleted sold photo is), while their row + storage stay for the
  // buyer. The event itself is soft-deleted below.
  if (purchasedPhotoIds.length > 0) {
    await softDeletePhotosByIds(supabaseAdmin, purchasedPhotoIds);
  }

  // Delete files from storage
  const pathsToRemove = coverPath ? [...storagePaths, coverPath] : storagePaths;
  if (pathsToRemove.length > 0) {
    await deleteStorageFiles(supabase, 'photos', pathsToRemove);
  }

  // Delete event
  await deleteEvent(supabase, eventId, user.id);

  // Fire-and-forget: clean up the AWS Rekognition collection (if any) on
  // the worker side. Failure to enqueue shouldn't block the user-facing
  // delete — log and continue. The collection will simply linger until a
  // future maintenance sweep.
  try {
    await inngest.send({ name: 'event.deleted', data: { eventId } });
  } catch (err) {
    console.error('[deleteEventAction] failed to enqueue event.deleted', err);
  }

  revalidatePath('/es/dashboard/photographer/events');
  revalidatePath('/en/dashboard/photographer/events');
  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  revalidateTag('events-public', 'max');
  revalidateTag('top-events', 'max');
  revalidateTag('filter-options', 'max');
  revalidateTag(`event-${eventId}`, 'max');
  if (event.share_code) {
    revalidateTag(`event-${event.share_code}`, 'max');
    revalidatePath(`/es/events/${event.share_code}`);
    revalidatePath(`/en/events/${event.share_code}`);
  }
  if (event.slug) {
    revalidateTag(`event-${event.slug}`, 'max');
    revalidatePath(`/es/events/${event.slug}`);
    revalidatePath(`/en/events/${event.slug}`);
  }
  revalidateTag(`photographer-events-${user.id}`, 'max');
  revalidateTag(`dashboard-photographer-${user.id}`, 'max');
  updateTag(`photographer-events-${user.id}`);
  updateTag(`dashboard-photographer-${user.id}`);

  // The photographer's public profile (`/photographer/[slug]`) lists this
  // event's card too — without this tag a deleted event keeps showing there
  // (click-through to a 404) until the tag's natural TTL.
  const { data: profile } = await supabase
    .from('profiles')
    .select('slug')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.slug) revalidateTag(`photographer-${profile.slug}`, 'max');
};
