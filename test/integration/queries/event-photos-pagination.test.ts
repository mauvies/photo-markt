/**
 * Integration tests for the paginated event-photo queries (T-060) in
 * `database/queries/photos.ts`:
 *   - getEventPhotosPublicPage / getEventPhotosPage — deterministic
 *     `(taken_at, id)` order, `hasMore`, non-overlapping windows.
 *   - countEventPhotosByStatus — true total independent of the rendered page.
 *   - getUploadedPhotoIdsForUserInEvent — owner + contributor uploads.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  countEventPhotosByStatus,
  getEventPhotosPage,
  getEventPhotosPublicPage,
  getUploadedPhotoIdsForUserInEvent,
  type SupabaseServerClient,
} from '@/database/queries';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** Insert an approved photo with an explicit `taken_at` and owner. */
async function insertPhoto(
  sb: SupabaseClient,
  args: {
    eventId: string;
    ownerId: string;
    takenAt: string;
    uploadStatus?: 'approved' | 'pending' | 'rejected';
    uploadedBy?: string | null;
  },
): Promise<string> {
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: args.ownerId,
      event_id: args.eventId,
      original_url: `${args.ownerId}/${args.eventId}/${crypto.randomUUID()}.jpg`,
      taken_at: args.takenAt,
      city: 'Barcelona',
      country: 'ES',
      state: 'Catalonia',
      upload_status: args.uploadStatus ?? 'approved',
      uploaded_by: args.uploadedBy ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertPhoto: ${error?.message ?? 'no data'}`);
  return data.id as string;
}

describe('database/queries/photos — pagination (T-060)', () => {
  let sb: SupabaseServerClient;

  beforeEach(async () => {
    await resetDatabase();
    sb = createServiceClient() as unknown as SupabaseServerClient;
  });

  it('pages never overlap or skip under (taken_at, id); hasMore flips on the last page', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const service = createServiceClient();
    // 5 photos, strictly increasing taken_at.
    for (let i = 0; i < 5; i++) {
      await insertPhoto(service, {
        eventId: event.id,
        ownerId: owner.id,
        takenAt: `2026-01-0${i + 1}T10:00:00.000Z`,
      });
    }

    const page1 = await getEventPhotosPublicPage(sb, event.id, { limit: 2, offset: 0 });
    const page2 = await getEventPhotosPublicPage(sb, event.id, { limit: 2, offset: 2 });
    const page3 = await getEventPhotosPublicPage(sb, event.id, { limit: 2, offset: 4 });

    expect(page1.photos).toHaveLength(2);
    expect(page2.photos).toHaveLength(2);
    expect(page3.photos).toHaveLength(1);
    expect(page1.hasMore).toBe(true);
    expect(page2.hasMore).toBe(true);
    expect(page3.hasMore).toBe(false);

    const ids = [...page1.photos, ...page2.photos, ...page3.photos].map((p) => p.id);
    // No overlap, no skip: 5 distinct ids covering every photo.
    expect(new Set(ids).size).toBe(5);
    // Chronological order preserved across pages.
    const takenAts = [...page1.photos, ...page2.photos, ...page3.photos].map((p) => p.taken_at);
    expect(takenAts).toEqual([...takenAts].sort());
  });

  it('breaks ties on id when taken_at is equal, so paging is stable', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const service = createServiceClient();
    const sameTime = '2026-02-02T12:00:00.000Z';
    for (let i = 0; i < 3; i++) {
      await insertPhoto(service, { eventId: event.id, ownerId: owner.id, takenAt: sameTime });
    }

    // Walk the whole set one row at a time; every row must appear exactly once.
    const collected: string[] = [];
    for (let offset = 0; offset < 3; offset++) {
      const { photos } = await getEventPhotosPublicPage(sb, event.id, { limit: 1, offset });
      expect(photos).toHaveLength(1);
      collected.push(photos[0].id);
    }
    expect(new Set(collected).size).toBe(3);
    // id-ascending tiebreak is deterministic.
    expect(collected).toEqual([...collected].sort());
  });

  it('public page returns approved photos only', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const service = createServiceClient();
    const approved = await insertPhoto(service, {
      eventId: event.id,
      ownerId: owner.id,
      takenAt: '2026-03-01T10:00:00.000Z',
    });
    await insertPhoto(service, {
      eventId: event.id,
      ownerId: owner.id,
      takenAt: '2026-03-02T10:00:00.000Z',
      uploadStatus: 'pending',
    });

    const { photos, hasMore } = await getEventPhotosPublicPage(sb, event.id, {
      limit: 50,
      offset: 0,
    });
    expect(photos.map((p) => p.id)).toEqual([approved]);
    expect(hasMore).toBe(false);
  });

  it('countEventPhotosByStatus reports the true total, not the rendered page', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const service = createServiceClient();
    for (let i = 0; i < 3; i++) {
      await insertPhoto(service, {
        eventId: event.id,
        ownerId: owner.id,
        takenAt: `2026-04-0${i + 1}T10:00:00.000Z`,
      });
    }
    await insertPhoto(service, {
      eventId: event.id,
      ownerId: owner.id,
      takenAt: '2026-04-09T10:00:00.000Z',
      uploadStatus: 'pending',
    });

    // Default = approved-only total (3), independent of a limit-1 page.
    expect(await countEventPhotosByStatus(sb, event.id)).toBe(3);
    // Widened to include pending.
    expect(await countEventPhotosByStatus(sb, event.id, ['approved', 'pending'])).toBe(4);
  });

  it('getEventPhotosPage widens to pending when includePending is set', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const service = createServiceClient();
    await insertPhoto(service, {
      eventId: event.id,
      ownerId: owner.id,
      takenAt: '2026-05-01T10:00:00.000Z',
    });
    await insertPhoto(service, {
      eventId: event.id,
      ownerId: owner.id,
      takenAt: '2026-05-02T10:00:00.000Z',
      uploadStatus: 'pending',
    });

    const approvedOnly = await getEventPhotosPage(sb, event.id, owner.id, {
      skipUserIdFilter: true,
      limit: 50,
      offset: 0,
    });
    expect(approvedOnly.photos).toHaveLength(1);

    const widened = await getEventPhotosPage(sb, event.id, owner.id, {
      skipUserIdFilter: true,
      includePending: true,
      limit: 50,
      offset: 0,
    });
    expect(widened.photos).toHaveLength(2);
  });

  it('getUploadedPhotoIdsForUserInEvent returns owner + contributor uploads', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const contributor = await createTestUser('TALENT');
    const event = await createTestEvent(owner.id);
    const service = createServiceClient();

    const ownerPhoto = await insertPhoto(service, {
      eventId: event.id,
      ownerId: owner.id,
      takenAt: '2026-06-01T10:00:00.000Z',
    });
    // Guest/contributor upload: row owner is the event owner, uploaded_by is
    // the contributor (mirrors the collaborative-upload shape).
    const contributorPhoto = await insertPhoto(service, {
      eventId: event.id,
      ownerId: owner.id,
      takenAt: '2026-06-02T10:00:00.000Z',
      uploadedBy: contributor.id,
    });

    const ownerIds = await getUploadedPhotoIdsForUserInEvent(sb, event.id, owner.id);
    expect(ownerIds).toContain(ownerPhoto);
    expect(ownerIds).toContain(contributorPhoto); // owner owns both rows

    const contributorIds = await getUploadedPhotoIdsForUserInEvent(sb, event.id, contributor.id);
    expect(contributorIds).toEqual([contributorPhoto]);
  });
});
