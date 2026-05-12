/**
 * Integration tests for talent photo Server Actions.
 *
 * Covers the "My Photos" library lifecycle:
 *   - listMyTaggedPhotos (auth gate + pagination + cart-state hydration)
 *   - removePhotosFromMyPhotosAction (untag, scoped to caller)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

vi.mock('@/app/[lang]/actions/roles', () => ({
  getActiveRole: vi.fn(async () => ({ activeRole: mockSession.activeRole })),
}));

vi.mock('@/database/server', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    createClient: vi.fn(async () => {
      const sb = createClient(
        'http://127.0.0.1:54321',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      sb.auth.getUser = vi.fn(async () => {
        if (!mockSession.userId) {
          return { data: { user: null }, error: null } as never;
        }
        return {
          data: { user: { id: mockSession.userId, email: `${mockSession.userId}@picdemi.test` } },
          error: null,
        } as never;
      });
      return sb;
    }),
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3000' })),
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
    getAll: vi.fn(() => []),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

import {
  listMyTaggedPhotos,
  removePhotosFromMyPhotosAction,
} from '@/app/[lang]/dashboard/talent/photos/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function tagPhoto(photoId: string, talentId: string, taggedByUserId: string) {
  const sb = createServiceClient();
  await sb.from('talent_photo_tags').insert({
    photo_id: photoId,
    talent_user_id: talentId,
    tagged_by_user_id: taggedByUserId,
  });
}

describe('listMyTaggedPhotos', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(listMyTaggedPhotos()).rejects.toThrow(/signed in/i);
  });

  it('returns only photos tagged for the calling talent (not other talents)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photoForA = await createTestPhoto(event.id);
    const photoForB = await createTestPhoto(event.id);

    const talentA = await createTestUser('TALENT');
    const talentB = await createTestUser('TALENT');
    await tagPhoto(photoForA.id, talentA.id, photographer.id);
    await tagPhoto(photoForB.id, talentB.id, photographer.id);

    mockSession.userId = talentA.id;
    const result = await listMyTaggedPhotos();
    expect(result.totalCount).toBe(1);
    // Photo IDs across all groups should be A's only.
    const allPhotoIds = result.groups.flatMap((g) =>
      g.dates.flatMap((d) => d.photos.map((p) => p.photo_id)),
    );
    expect(allPhotoIds).toEqual([photoForA.id]);
  });

  it('returns an empty result for a talent with no tagged photos (no throw)', async () => {
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    const result = await listMyTaggedPhotos();
    expect(result.totalCount).toBe(0);
    expect(result.groups).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('hasMore is true when offset + page size is less than totalCount', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const talent = await createTestUser('TALENT');
    // Tag 4 photos.
    for (let i = 0; i < 4; i++) {
      const p = await createTestPhoto(event.id);
      await tagPhoto(p.id, talent.id, photographer.id);
    }
    mockSession.userId = talent.id;

    const page = await listMyTaggedPhotos({ limit: 2, offset: 0 });
    expect(page.totalCount).toBe(4);
    expect(page.hasMore).toBe(true);

    const last = await listMyTaggedPhotos({ limit: 2, offset: 2 });
    expect(last.totalCount).toBe(4);
    expect(last.hasMore).toBe(false);
  });
});

describe('removePhotosFromMyPhotosAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(removePhotosFromMyPhotosAction(['anything'])).rejects.toThrow(/signed in/i);
  });

  it('untags the photos for the calling talent', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const a = await createTestPhoto(event.id);
    const b = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');
    await tagPhoto(a.id, talent.id, photographer.id);
    await tagPhoto(b.id, talent.id, photographer.id);

    mockSession.userId = talent.id;
    expect((await listMyTaggedPhotos()).totalCount).toBe(2);

    await removePhotosFromMyPhotosAction([a.id]);

    const after = await listMyTaggedPhotos();
    expect(after.totalCount).toBe(1);
    const remaining = after.groups.flatMap((g) =>
      g.dates.flatMap((d) => d.photos.map((p) => p.photo_id)),
    );
    expect(remaining).toEqual([b.id]);
  });

  it('does NOT touch tags belonging to a different talent', async () => {
    // Caller asks to remove a photo that's tagged for someone ELSE. The
    // underlying query scopes the delete by `talent_user_id = caller`, so
    // the row stays put.
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);
    const owner = await createTestUser('TALENT');
    const attacker = await createTestUser('TALENT');
    await tagPhoto(photo.id, owner.id, photographer.id);

    mockSession.userId = attacker.id;
    await removePhotosFromMyPhotosAction([photo.id]);

    // The owner's tag is still there.
    mockSession.userId = owner.id;
    expect((await listMyTaggedPhotos()).totalCount).toBe(1);
  });

  it('is a no-op for an empty list (no auth check, no DB write)', async () => {
    await expect(removePhotosFromMyPhotosAction([])).resolves.toBeUndefined();
  });
});
