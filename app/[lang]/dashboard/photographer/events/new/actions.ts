'use server';

import { Buffer } from 'node:buffer';
import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import { z } from 'zod';
import {
  createPhoto,
  createEvent as dbCreateEvent,
  deleteEvent,
  deleteEventPhotos,
  deleteStorageFiles,
  uploadFile,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { generateEventSlug } from '@/lib/slugify';
import { activityValues } from './activity-options';

const eventSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  activity: z
    .string()
    .min(1, 'Activity is required.')
    .refine(
      (value): value is (typeof activityValues)[number] =>
        activityValues.includes(value as (typeof activityValues)[number]),
      'Activity is required.',
    ),
  date: z.string().min(1, 'Date is required.'),
  country: z.string().trim().optional().default(''),
  state: z.string().trim().optional().default(''),
  city: z.string().trim().optional(),
  is_public: z
    .string()
    .default('true')
    .transform((val) => val === 'true'),
  watermark_enabled: z
    .string()
    .default('true')
    .transform((val) => val === 'true'),
  price_per_photo: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val.trim() === '') return null;
      const num = Number.parseFloat(val);
      return Number.isNaN(num) || num < 0 ? null : num;
    }),
});

type EventPayload = z.infer<typeof eventSchema>;

type CreateEventResult = {
  eventId: string;
  shareCode: string | null;
};

export const createEvent = async (formData: FormData): Promise<CreateEventResult> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to create an event.');
  }

  const rawPayload: Record<string, FormDataEntryValue | null> = {
    name: formData.get('name'),
    activity: formData.get('activity'),
    date: formData.get('date'),
    country: formData.get('country'),
    state: formData.get('state'),
    city: formData.get('city'),
    is_public: formData.get('is_public'),
    watermark_enabled: formData.get('watermark_enabled'),
    price_per_photo: formData.get('price_per_photo'),
  };

  const parsed = eventSchema.safeParse({
    name: rawPayload.name?.toString() ?? '',
    activity: rawPayload.activity?.toString() ?? '',
    date: rawPayload.date?.toString() ?? '',
    country: rawPayload.country?.toString() ?? '',
    state: rawPayload.state?.toString(),
    city: rawPayload.city?.toString(),
    is_public: rawPayload.is_public?.toString() ?? 'true',
    watermark_enabled: rawPayload.watermark_enabled?.toString() ?? 'true',
    price_per_photo: rawPayload.price_per_photo?.toString(),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid event data provided.');
  }

  const payload: EventPayload = parsed.data;
  const uploadedFiles = formData
    .getAll('photos')
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (uploadedFiles.length === 0) {
    throw new Error('Add at least one photo to continue.');
  }

  // Generate share code for private events
  let shareCode: string | null = null;
  if (!payload.is_public) {
    // Generate a random 8-character alphanumeric code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding ambiguous chars
    shareCode = Array.from({ length: 8 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length)),
    ).join('');
  }

  // Watermark only applies to public events
  const watermarkEnabled = payload.is_public && payload.watermark_enabled;

  const event = await dbCreateEvent(supabase, user.id, {
    name: payload.name,
    activity: payload.activity,
    date: payload.date,
    country: payload.country,
    state: payload.state,
    city: payload.city || '',
    is_public: payload.is_public,
    share_code: shareCode,
    price_per_photo: payload.price_per_photo ?? null,
    watermark_enabled: watermarkEnabled,
    // Slug is only set on public events (private events use share codes)
    slug: null,
  });

  // Generate SEO slug for public events after we have the event ID.
  // We first try the clean base slug; if it's already taken we append
  // the first 6 chars of the event UUID to guarantee uniqueness.
  if (payload.is_public) {
    const year = new Date(payload.date).getFullYear();
    const baseSlug = generateEventSlug(payload.name, payload.city || '', year);

    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('slug', baseSlug)
      .maybeSingle();

    const finalSlug = existing
      ? generateEventSlug(payload.name, payload.city || '', year, event.id.slice(0, 6))
      : baseSlug;

    await supabase
      .from('events')
      .update({ slug: finalSlug })
      .eq('id', event.id)
      .eq('user_id', user.id);
  }

  const photoRecords: { original_path: string }[] = [];

  try {
    for (const file of uploadedFiles) {
      const fileId = crypto.randomUUID();
      const extension = file.name.split('.').pop();
      const safeName = extension ? `${fileId}.${extension.toLowerCase()}` : `${fileId}`;
      const path = `${user.id}/${event.id}/${safeName}`;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await uploadFile(supabase, 'photos', path, buffer, {
        contentType: file.type || undefined,
        upsert: false,
      });

      await createPhoto(supabase, user.id, {
        event_id: event.id,
        original_url: path,
        taken_at: new Date(payload.date).toISOString(),
        city: payload.city || '',
        country: payload.country,
        state: payload.state || null,
      });

      photoRecords.push({ original_path: path });
    }
  } catch (error) {
    console.error('createEvent: upload failed', error);
    await deleteEventPhotos(supabase, event.id, user.id);
    await deleteStorageFiles(
      supabase,
      'photos',
      photoRecords.map((record) => record.original_path),
    );
    await deleteEvent(supabase, event.id, user.id);

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null
          ? JSON.stringify(error)
          : 'Unable to upload photos. Please try again.';
    throw new Error(message);
  }

  revalidatePath('/es/dashboard/photographer/events');
  revalidatePath('/en/dashboard/photographer/events');
  revalidatePath(`/es/dashboard/photographer/events/${event.id}`);
  revalidatePath(`/en/dashboard/photographer/events/${event.id}`);
  revalidateTag('events-public', 'max');
  revalidateTag('filter-options', 'max');
  revalidateTag(`photographer-events-${user.id}`, 'max');
  revalidateTag(`dashboard-photographer-${user.id}`, 'max');
  updateTag(`photographer-events-${user.id}`);
  updateTag(`dashboard-photographer-${user.id}`);

  // Bust the public photographer profile cache
  const { data: photographerProfile } = await supabase
    .from('profiles')
    .select('slug')
    .eq('id', user.id)
    .maybeSingle();
  if (photographerProfile?.slug) revalidateTag(`photographer-${photographerProfile.slug}`, 'max');

  return { eventId: event.id, shareCode };
};
