'use server';

import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import {
  deletePhoto as dbDeletePhoto,
  deleteEvent,
  deleteEventPhotos,
  deleteStorageFiles,
  getEvent,
  getPhoto,
  getPhotoStoragePaths,
} from '@/database/queries';
import { createClient } from '@/database/server';

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

  // Get storage paths before deleting photos
  const storagePaths = await getPhotoStoragePaths(supabase, eventId, user.id);

  // Delete photos from database
  await deleteEventPhotos(supabase, eventId, user.id);

  // Delete files from storage
  if (storagePaths.length > 0) {
    await deleteStorageFiles(supabase, 'photos', storagePaths);
  }

  // Delete event
  await deleteEvent(supabase, eventId, user.id);

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
};

/** Delete a single photo from an event (database + storage). */
export const deletePhoto = async (photoId: string, eventId: string) => {
  if (!photoId) {
    throw new Error('Photo id is required.');
  }
  if (!eventId) {
    throw new Error('Event id is required.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to delete a photo.');
  }

  const photo = await getPhoto(supabase, photoId, eventId, user.id);

  if (!photo) {
    throw new Error('Photo not found.');
  }

  // Delete photo from database
  await dbDeletePhoto(supabase, photoId, user.id);

  // Delete file from storage
  if (photo.original_url) {
    await deleteStorageFiles(supabase, 'photos', [photo.original_url]);
  }

  revalidatePath('/es/dashboard/photographer/events');
  revalidatePath('/en/dashboard/photographer/events');
  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  revalidateTag('events-public', 'max');
  revalidateTag('top-events', 'max');
  revalidateTag(`event-${eventId}`, 'max');
  revalidateTag(`photographer-events-${user.id}`, 'max');
  updateTag(`photographer-events-${user.id}`);
};
