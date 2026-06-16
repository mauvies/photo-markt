/**
 * Integration tests for `deleteContributorPhotoAction` in
 * `app/[lang]/events/[shareCode]/actions.ts`.
 *
 * This action backs the bulk-delete flow on collaborative event galleries
 * (public `/events/[code]` and the talent dashboard). Authorization is
 * enforced in code (the action runs as the service role), so the branches are
 * the important thing to lock down:
 *
 *   1. Authenticated event owner       → may delete any photo of the event.
 *   2. Authenticated row owner          → may delete their own upload, matched
 *      by photos.user_id (authenticated uploads leave uploaded_by null — this
 *      is the branch the "My photos" delete regression added).
 *   3. Anonymous guest with delete token → may delete the matching photo.
 *   4. Everyone else                     → rejected; the row survives.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

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
  updateTag: vi.fn(),
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

import { deleteContributorPhotoAction } from '@/app/[lang]/events/[shareCode]/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** A collaborative event with a share code (required by the action). */
async function makeCollaborativeEvent(ownerId: string): Promise<{ id: string; shareCode: string }> {
  const event = await createTestEvent(ownerId, { is_public: false, price_per_photo: null });
  const sb = createServiceClient();
  const { error } = await sb
    .from('events')
    .update({ is_collaborative: true, allow_guest_upload: true })
    .eq('id', event.id);
  if (error) throw new Error(`makeCollaborativeEvent: ${error.message}`);
  if (!event.share_code) throw new Error('makeCollaborativeEvent: missing share code');
  return { id: event.id, shareCode: event.share_code };
}

/** Seed a photo with explicit ownership/attribution fields. */
async function seedPhoto(
  eventId: string,
  fields: { userId: string; uploadedBy?: string | null; deleteToken?: string | null },
): Promise<{ id: string }> {
  const sb = createServiceClient();
  const suffix = crypto.randomUUID();
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: fields.userId,
      event_id: eventId,
      original_url: `${fields.userId}/${eventId}/${suffix}.jpg`,
      taken_at: new Date().toISOString(),
      uploaded_by: fields.uploadedBy ?? null,
      delete_token: fields.deleteToken ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedPhoto: ${error?.message ?? 'no data'}`);
  return { id: data.id };
}

async function photoExists(photoId: string): Promise<boolean> {
  const sb = createServiceClient();
  const { data } = await sb.from('photos').select('id').eq('id', photoId).maybeSingle();
  return Boolean(data);
}

describe('deleteContributorPhotoAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  it('lets an authenticated contributor delete their own upload (matched by user_id)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const contributor = await createTestUser('TALENT');
    const { id: eventId, shareCode } = await makeCollaborativeEvent(owner.id);
    // Authenticated uploads set user_id but leave uploaded_by null.
    const photo = await seedPhoto(eventId, { userId: contributor.id, uploadedBy: null });

    mockSession.userId = contributor.id;
    await expect(deleteContributorPhotoAction({ photoId: photo.id, shareCode })).resolves.toEqual({
      success: true,
    });
    expect(await photoExists(photo.id)).toBe(false);
  });

  it('lets the event owner delete a contributor photo', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const contributor = await createTestUser('TALENT');
    const { id: eventId, shareCode } = await makeCollaborativeEvent(owner.id);
    const photo = await seedPhoto(eventId, { userId: contributor.id, uploadedBy: null });

    mockSession.userId = owner.id;
    await expect(deleteContributorPhotoAction({ photoId: photo.id, shareCode })).resolves.toEqual({
      success: true,
    });
    expect(await photoExists(photo.id)).toBe(false);
  });

  it('lets an anonymous guest delete with a matching delete token', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const { id: eventId, shareCode } = await makeCollaborativeEvent(owner.id);
    const token = crypto.randomUUID();
    // Guest upload: user_id falls back to the event owner, uploaded_by null.
    const photo = await seedPhoto(eventId, {
      userId: owner.id,
      uploadedBy: null,
      deleteToken: token,
    });

    mockSession.userId = null;
    await expect(
      deleteContributorPhotoAction({ photoId: photo.id, shareCode, deleteToken: token }),
    ).resolves.toEqual({ success: true });
    expect(await photoExists(photo.id)).toBe(false);
  });

  it('rejects a guest without the matching delete token (row survives)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const { id: eventId, shareCode } = await makeCollaborativeEvent(owner.id);
    const photo = await seedPhoto(eventId, {
      userId: owner.id,
      uploadedBy: null,
      deleteToken: crypto.randomUUID(),
    });

    mockSession.userId = null;
    await expect(
      deleteContributorPhotoAction({ photoId: photo.id, shareCode, deleteToken: 'wrong-token' }),
    ).rejects.toThrow(/not authorized/i);
    expect(await photoExists(photo.id)).toBe(true);
  });

  it("rejects an authenticated user who is neither the owner nor the photo's uploader", async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const contributor = await createTestUser('TALENT');
    const attacker = await createTestUser('TALENT');
    const { id: eventId, shareCode } = await makeCollaborativeEvent(owner.id);
    const photo = await seedPhoto(eventId, { userId: contributor.id, uploadedBy: null });

    mockSession.userId = attacker.id;
    await expect(deleteContributorPhotoAction({ photoId: photo.id, shareCode })).rejects.toThrow(
      /not authorized/i,
    );
    expect(await photoExists(photo.id)).toBe(true);
  });

  it('rejects deletion on a non-collaborative event', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const contributor = await createTestUser('TALENT');
    // A plain (non-collaborative) event with a share code.
    const event = await createTestEvent(owner.id);
    const photo = await seedPhoto(event.id, { userId: contributor.id });

    mockSession.userId = contributor.id;
    await expect(
      deleteContributorPhotoAction({ photoId: photo.id, shareCode: event.share_code ?? '' }),
    ).rejects.toThrow(/event not found/i);
    expect(await photoExists(photo.id)).toBe(true);
  });
});
