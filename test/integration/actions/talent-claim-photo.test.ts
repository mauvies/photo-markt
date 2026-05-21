/**
 * Integration tests for `addPhotoToProfileAction` — claiming a FREE event
 * photo into the talent's owned-photos collection (`talent_claimed_photos`).
 *
 * SECURITY-CRITICAL: only FREE photos may be claimed. A paid photo must be
 * purchased, never claimed for free — the action enforces this server-side
 * regardless of what the client sends.
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
          data: {
            user: { id: mockSession.userId, email: `${mockSession.userId}@photomarkt.test` },
          },
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

import { addPhotoToProfileAction } from '@/app/[lang]/dashboard/talent/events/[id]/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function claimCount(photoId: string, talentId: string): Promise<number> {
  const sb = createServiceClient();
  const { count } = await sb
    .from('talent_claimed_photos')
    .select('*', { count: 'exact', head: true })
    .eq('photo_id', photoId)
    .eq('talent_user_id', talentId);
  return count ?? 0;
}

describe('addPhotoToProfileAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(addPhotoToProfileAction('any-id')).rejects.toThrow(/signed in/i);
  });

  it('rejects a non-talent (photographer) caller', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const photo = await createTestPhoto(event.id);
    mockSession.userId = photographer.id;
    mockSession.activeRole = 'photographer';
    await expect(addPhotoToProfileAction(photo.id)).rejects.toThrow(/talent/i);
  });

  it('claims a free-event photo for the talent', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;

    await addPhotoToProfileAction(photo.id);
    expect(await claimCount(photo.id, talent.id)).toBe(1);
  });

  it('rejects claiming a PAID-event photo', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;

    await expect(addPhotoToProfileAction(photo.id)).rejects.toThrow(/free/i);
    expect(await claimCount(photo.id, talent.id)).toBe(0);
  });

  it('is idempotent — a second claim neither throws nor duplicates', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;

    await addPhotoToProfileAction(photo.id);
    await expect(addPhotoToProfileAction(photo.id)).resolves.toBeUndefined();
    expect(await claimCount(photo.id, talent.id)).toBe(1);
  });

  it('rejects an unknown photo id', async () => {
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    await expect(addPhotoToProfileAction('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      /not found/i,
    );
  });
});
