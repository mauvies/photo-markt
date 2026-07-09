/**
 * T-088: cache-tag characterization + regression for the `photo.uploaded`
 * worker's approval-promotion step (`runIndexPhotoFacesFlow` in
 * `index-photo-faces.ts`).
 *
 * Before this ticket, promoting a photo to `upload_status='approved'` only
 * revalidated `event-${id|slug|share_code}` — never the listing tags. An
 * event's first approved photo (the "Featured"/search eligibility gate)
 * could stay invisible on the home page and search for up to 55 min.
 *
 * The fix busts the listing tags unconditionally on every approval — an
 * earlier version tried to gate the public-tag bust to only the approved
 * count's `0 -> 1` transition, but that raced under this worker's own
 * per-event concurrency (multiple photos of the same event can promote
 * concurrently) and could silently skip the bust. `revalidateTag` is cheap
 * (marks a tag stale, doesn't redo work), so unconditional is correct.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import sharp from 'sharp';
import {
  type PhotoProcessedSender,
  type PhotoUploadStep,
  runIndexPhotoFacesFlow,
} from '@/lib/inngest/functions/index-photo-faces';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const passthroughStep: PhotoUploadStep = {
  async run<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};

const noopSend: PhotoProcessedSender = async () => undefined;

async function uploadJpeg(path: string, sb = createServiceClient()): Promise<number> {
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#7788aa' },
  })
    .jpeg()
    .toBuffer();
  const { error } = await sb.storage
    .from('photos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`uploadJpeg: ${error.message}`);
  return bytes.byteLength;
}

async function insertPhoto(args: {
  userId: string;
  eventId: string;
  originalUrl: string;
  sizeBytes: number;
  uploadStatus: 'pending' | 'approved' | 'rejected';
}): Promise<{ id: string }> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: args.userId,
      event_id: args.eventId,
      original_url: args.originalUrl,
      taken_at: new Date().toISOString(),
      city: 'Barcelona',
      country: 'ES',
      state: 'Catalonia',
      size_bytes: args.sizeBytes,
      upload_status: args.uploadStatus,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertPhoto: ${error?.message ?? 'no data'}`);
  return { id: data.id as string };
}

function revalidatedTags(): unknown[] {
  return vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
}

describe('runIndexPhotoFacesFlow — cache tag revalidation (T-088)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    vi.mocked(revalidateTag).mockClear();
  });

  it("promoting an event's FIRST approved photo busts the detail, owner, and public listing tags", async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const storagePath = `${owner.id}/${event.id}/first-approved.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
    });

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      noopSend,
    );

    const tags = revalidatedTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        `event-${event.id}`,
        'events-public',
        'top-events',
        `photographer-${owner.username}`,
        `photographer-events-${owner.id}`,
        `dashboard-photographer-${owner.id}`,
      ]),
    );
  });

  it('promoting a SECOND approved photo of an already-visible event still busts the public listing tags (unconditional — avoids the boundary-check race)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    // Pre-seed one already-approved photo — the event already cleared the
    // `>= 1` visibility boundary before this test's photo runs. A
    // boundary-gated bust would skip busting the public tags here; the
    // unconditional fix busts them regardless, which is what makes it
    // immune to the concurrent-promotion race.
    await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: `${owner.id}/${event.id}/pre-existing-approved.jpg`,
      sizeBytes: 1024,
      uploadStatus: 'approved',
    });

    const storagePath = `${owner.id}/${event.id}/second-approved.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
    });

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      noopSend,
    );

    const tags = revalidatedTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        'events-public',
        'top-events',
        `photographer-${owner.username}`,
        `photographer-events-${owner.id}`,
        `dashboard-photographer-${owner.id}`,
      ]),
    );
  });

  it('concurrent promotions of multiple photos on the same new event each bust the public listing tags (no boundary-check race)', async () => {
    // Regression for the race a boundary-gated ("only bust when the
    // approved count is exactly 1") version had: this worker fans out to
    // one Inngest invocation per photo, with up to 5 running concurrently
    // for the same event. If several `promoteToApproved` calls commit
    // before any of their own COUNT queries run, every invocation could
    // read a post-promotion count > 1 and none of them would bust the
    // public tags — an event's very first photos could go permanently
    // uncached-busted. Running the flow concurrently for 3 fresh photos
    // pins that this can't happen with the unconditional fix.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const photos = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const storagePath = `${owner.id}/${event.id}/concurrent-${i}.jpg`;
        const sizeBytes = await uploadJpeg(storagePath);
        const photo = await insertPhoto({
          userId: owner.id,
          eventId: event.id,
          originalUrl: storagePath,
          sizeBytes,
          uploadStatus: 'pending',
        });
        return { ...photo, storagePath };
      }),
    );

    await Promise.all(
      photos.map((photo) =>
        runIndexPhotoFacesFlow(
          { photoId: photo.id, eventId: event.id, storagePath: photo.storagePath },
          passthroughStep,
          noopSend,
        ),
      ),
    );

    const tags = revalidatedTags();
    // At least one call — in practice every call — busts the public tags;
    // the race would have made this assertion fail (zero occurrences).
    expect(tags.filter((t) => t === 'events-public').length).toBeGreaterThan(0);
    expect(tags.filter((t) => t === 'top-events').length).toBeGreaterThan(0);
  });
});
