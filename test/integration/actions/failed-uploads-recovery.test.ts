/**
 * T-231: the owner's two ways out of a `upload_status='failed'` upload —
 * `retryFailedUploadsAction` and `discardFailedUploadsAction`
 * (`app/[lang]/dashboard/photographer/events/[id]/actions.ts`).
 *
 * A `failed` photo is terminal on purpose: the run exhausted its retries, and
 * the reconcile cron deliberately leaves exhausted photos alone (auto-requeuing
 * them is the retry storm T-231 removed). These actions are therefore the ONLY
 * recovery path, which makes their auth gate and their re-drive semantics
 * load-bearing.
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
        if (!mockSession.userId) return { data: { user: null }, error: null } as never;
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

const inngestSend = vi.fn();
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: (...a: unknown[]) => inngestSend(...a) },
}));

import {
  discardFailedUploadsAction,
  retryFailedUploadsAction,
} from '@/app/[lang]/dashboard/photographer/events/[id]/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function insertFailedPhoto(ownerId: string, eventId: string): Promise<string> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: ownerId,
      event_id: eventId,
      original_url: `${ownerId}/${eventId}/${crypto.randomUUID()}.jpg`,
      taken_at: new Date().toISOString(),
      city: 'Huelva',
      country: 'ES',
      upload_status: 'failed',
      face_index_status: 'failed',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertFailedPhoto: ${error?.message ?? 'no data'}`);
  return data.id as string;
}

async function readPhoto(
  photoId: string,
): Promise<{ upload_status: string; face_index_status: string } | null> {
  const { data } = await createServiceClient()
    .from('photos')
    .select('upload_status, face_index_status')
    .eq('id', photoId)
    .maybeSingle();
  return (data as { upload_status: string; face_index_status: string } | null) ?? null;
}

describe('failed-upload recovery actions (T-231)', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    inngestSend.mockReset();
  });

  it('retry resets BOTH pipeline columns and re-emits photo.uploaded', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photoId = await insertFailedPhoto(owner.id, event.id);
    mockSession.userId = owner.id;

    const result = await retryFailedUploadsAction(event.id);

    expect(result.count).toBe(1);
    // `face_index_status` must move too: it is what the reconcile cron reads to
    // decide a photo is exhausted, so leaving it `failed` would make the retry
    // unrecoverable if the emit below were lost.
    expect(await readPhoto(photoId)).toEqual({
      upload_status: 'pending',
      face_index_status: 'pending',
    });
    expect(inngestSend).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'photo.uploaded',
        data: expect.objectContaining({ photoId }),
      }),
    ]);
  });

  it('retry is a no-op when nothing failed — no bogus events enqueued', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    mockSession.userId = owner.id;

    expect((await retryFailedUploadsAction(event.id)).count).toBe(0);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('discard removes the rows for good', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photoId = await insertFailedPhoto(owner.id, event.id);
    mockSession.userId = owner.id;

    const result = await discardFailedUploadsAction(event.id);

    expect(result.count).toBe(1);
    expect(await readPhoto(photoId)).toBeNull();
  });

  it('neither action touches photos that are not failed', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const sb = createServiceClient();
    const { data } = await sb
      .from('photos')
      .insert({
        user_id: owner.id,
        event_id: event.id,
        original_url: `${owner.id}/${event.id}/live.jpg`,
        taken_at: new Date().toISOString(),
        upload_status: 'approved',
      })
      .select('id')
      .single();
    const approvedId = (data as { id: string }).id;
    mockSession.userId = owner.id;

    await retryFailedUploadsAction(event.id);
    await discardFailedUploadsAction(event.id);

    expect((await readPhoto(approvedId))?.upload_status).toBe('approved');
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('rejects a photographer who does not own the event', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const stranger = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photoId = await insertFailedPhoto(owner.id, event.id);
    mockSession.userId = stranger.id;

    await expect(retryFailedUploadsAction(event.id)).rejects.toThrow();
    await expect(discardFailedUploadsAction(event.id)).rejects.toThrow();
    // Still there, still failed — a stranger can neither re-drive nor destroy.
    expect((await readPhoto(photoId))?.upload_status).toBe('failed');
  });

  it('rejects an anonymous caller', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await insertFailedPhoto(owner.id, event.id);
    mockSession.userId = null;

    await expect(retryFailedUploadsAction(event.id)).rejects.toThrow();
    await expect(discardFailedUploadsAction(event.id)).rejects.toThrow();
  });
});
