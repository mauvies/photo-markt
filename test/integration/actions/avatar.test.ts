/**
 * Integration tests for the shared avatar actions (T-182) in
 * `app/[lang]/actions/avatar.ts`. Exercises the real local Supabase: the public
 * `avatars` bucket, `profiles.avatar_url`, and auth metadata.
 */

import { Buffer } from 'node:buffer';
import sharp from 'sharp';
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
}));

import { removeAvatarAction, updateAvatarAction } from '@/app/[lang]/actions/avatar';
import {
  createServiceClient,
  createTestUser,
  ensureAvatarsBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function pngFile(): Promise<File> {
  const buf = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
  return new File([new Uint8Array(buf)], 'me.png', { type: 'image/png' });
}

function formWith(file: File): FormData {
  const fd = new FormData();
  fd.append('avatar', file);
  return fd;
}

async function listUserAvatarObjects(userId: string): Promise<string[]> {
  const { data } = await createServiceClient().storage.from('avatars').list(userId);
  return (data ?? []).map((o) => o.name);
}

async function readAvatarUrl(userId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from('profiles')
    .select('avatar_url')
    .eq('id', userId)
    .single();
  return (data?.avatar_url as string | null) ?? null;
}

describe('avatar actions (T-182)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensureAvatarsBucket();
    mockSession.userId = null;
  });

  it('rejects when not authenticated', async () => {
    const res = await updateAvatarAction(formWith(await pngFile()));
    expect(res).toEqual({ ok: false, error: 'not-authenticated' });
  });

  it('uploads a valid image, writes avatar_url, and returns a public URL', async () => {
    const user = await createTestUser('TALENT');
    mockSession.userId = user.id;

    const res = await updateAvatarAction(formWith(await pngFile()));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.avatarUrl).toContain(`/avatars/${user.id}/`);
    }
    expect(await readAvatarUrl(user.id)).toContain(`/avatars/${user.id}/`);
    expect(await listUserAvatarObjects(user.id)).toHaveLength(1);
  });

  it('rejects a non-image (magic bytes) with invalid-type and writes nothing', async () => {
    const user = await createTestUser('TALENT');
    mockSession.userId = user.id;

    const bad = new File([new Uint8Array(Buffer.from('definitely not an image'))], 'x.png', {
      type: 'image/png',
    });
    const res = await updateAvatarAction(formWith(bad));
    expect(res).toEqual({ ok: false, error: 'invalid-type' });
    expect(await readAvatarUrl(user.id)).toBeNull();
    expect(await listUserAvatarObjects(user.id)).toHaveLength(0);
  });

  it('delete-on-replace: replacing removes the previous object, only the newest remains', async () => {
    const user = await createTestUser('TALENT');
    mockSession.userId = user.id;

    await updateAvatarAction(formWith(await pngFile()));
    const first = await listUserAvatarObjects(user.id);
    expect(first).toHaveLength(1);

    await updateAvatarAction(formWith(await pngFile()));
    const second = await listUserAvatarObjects(user.id);
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]); // old object deleted, new one written
  });

  it('removeAvatarAction clears avatar_url and deletes the stored object', async () => {
    const user = await createTestUser('TALENT');
    mockSession.userId = user.id;

    await updateAvatarAction(formWith(await pngFile()));
    expect(await listUserAvatarObjects(user.id)).toHaveLength(1);

    const res = await removeAvatarAction();
    expect(res).toEqual({ ok: true, avatarUrl: null });
    expect(await readAvatarUrl(user.id)).toBeNull();
    expect(await listUserAvatarObjects(user.id)).toHaveLength(0);
  });
});
