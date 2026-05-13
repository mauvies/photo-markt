/**
 * Integration tests for the public collaborative-event Server Actions:
 *   - uploadGuestPhotosAction       (events/[shareCode]/actions.ts)
 *   - deleteContributorPhotoAction  (events/[shareCode]/actions.ts)
 *
 * These are the only **unauthenticated** server actions in the app that write
 * to storage + DB. The tests pin every authorization branch and every
 * input-validation gate, including the `validatePhotoUpload` integration that
 * keeps stored-XSS and storage-cost-DoS off the table.
 *
 * Not covered here (acknowledged gap):
 *   - The (event, IP) rate limiter at 30/hour. Exercising it requires 31
 *     uploads per test which is slow; the limiter itself has unit coverage
 *     in `test/unit/lib/rate-limit.test.ts`.
 */

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

import {
  deleteContributorPhotoAction,
  uploadGuestPhotosAction,
} from '@/app/[lang]/events/[shareCode]/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeJpegFile(name = 'photo.jpg'): Promise<File> {
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#445566' },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(buf)], name, { type: 'image/jpeg' });
}

/** Today as YYYY-MM-DD so `isCollaborativeUploadOpen` returns true. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A date safely in the future so `isCollaborativeUploadOpen` returns false. */
function futureIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Build FormData for `uploadGuestPhotosAction`. */
function buildUploadFormData(
  shareCode: string,
  options: {
    guestName?: string;
    guestEmail?: string;
    files?: File[];
  } = {},
): FormData {
  const fd = new FormData();
  fd.append('share_code', shareCode);
  if (options.guestName !== undefined) fd.append('guest_name', options.guestName);
  if (options.guestEmail !== undefined) fd.append('guest_email', options.guestEmail);
  for (const f of options.files ?? []) fd.append('photos', f);
  return fd;
}

/** Build a collaborative event with sensible defaults. */
async function makeCollabEvent(
  photographerId: string,
  overrides: {
    allow_guest_upload?: boolean;
    require_upload_approval?: boolean;
    date?: string;
    is_collaborative?: boolean;
  } = {},
) {
  const sb = createServiceClient();
  // `createTestEvent` defaults `is_collaborative=false` and `date=2026-01-01`.
  // Build via service client so we can set the collaborative flags directly.
  const suffix = crypto.randomUUID().slice(0, 8);
  const { data, error } = await sb
    .from('events')
    .insert({
      user_id: photographerId,
      name: `Collab Event ${suffix}`,
      date: overrides.date ?? todayIso(),
      city: 'Barcelona',
      country: 'ES',
      state: 'Catalonia',
      activity: 'SURF',
      is_public: true,
      slug: `collab-${suffix}`,
      share_code: suffix.toUpperCase(),
      is_collaborative: overrides.is_collaborative ?? true,
      allow_guest_upload: overrides.allow_guest_upload ?? true,
      require_upload_approval: overrides.require_upload_approval ?? false,
      type: overrides.is_collaborative === false ? 'solo' : 'collaborative',
    })
    .select('id, share_code, slug, user_id')
    .single();
  if (error || !data) throw new Error(`makeCollabEvent: ${error?.message}`);
  return data as {
    id: string;
    share_code: string;
    slug: string | null;
    user_id: string;
  };
}

// ─── uploadGuestPhotosAction ──────────────────────────────────────────────────

describe('uploadGuestPhotosAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  it('rejects when share_code is missing', async () => {
    const fd = new FormData();
    await expect(uploadGuestPhotosAction(fd)).rejects.toThrow(/missing share code/i);
  });

  it('rejects when the event does not exist', async () => {
    const fd = buildUploadFormData('NOEVENT1', {
      guestName: 'Test',
      files: [await makeJpegFile()],
    });
    await expect(uploadGuestPhotosAction(fd)).rejects.toThrow(/not accepting contributions/i);
  });

  it('rejects when the event is not collaborative', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id, { is_collaborative: false });

    const fd = buildUploadFormData(event.share_code, {
      guestName: 'Guest',
      files: [await makeJpegFile()],
    });
    await expect(uploadGuestPhotosAction(fd)).rejects.toThrow(/not accepting contributions/i);
  });

  it('rejects when the event has allow_guest_upload=false', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id, { allow_guest_upload: false });

    const fd = buildUploadFormData(event.share_code, {
      guestName: 'Guest',
      files: [await makeJpegFile()],
    });
    await expect(uploadGuestPhotosAction(fd)).rejects.toThrow(/not accepting contributions/i);
  });

  it('rejects when the event date is in the future (uploads only open from event day)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id, { date: futureIso() });

    const fd = buildUploadFormData(event.share_code, {
      guestName: 'Guest',
      files: [await makeJpegFile()],
    });
    await expect(uploadGuestPhotosAction(fd)).rejects.toThrow(/uploads open on the day/i);
  });

  it('rejects when no files are attached', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id);

    const fd = buildUploadFormData(event.share_code, { guestName: 'Guest' });
    await expect(uploadGuestPhotosAction(fd)).rejects.toThrow(/at least one photo/i);
  });

  it('rejects an unauthenticated guest without a name', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id);

    const fd = buildUploadFormData(event.share_code, {
      // No guestName.
      files: [await makeJpegFile()],
    });
    await expect(uploadGuestPhotosAction(fd)).rejects.toThrow(/enter your name/i);
  });

  it('rejects an invalid email format', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id);

    const fd = buildUploadFormData(event.share_code, {
      guestName: 'Guest',
      guestEmail: 'not-an-email',
      files: [await makeJpegFile()],
    });
    await expect(uploadGuestPhotosAction(fd)).rejects.toThrow(/valid email/i);
  });

  it('rejects a file that fails magic-byte validation', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id);

    const evil = new File(
      [new Uint8Array(new TextEncoder().encode('<svg onload="alert(1)"/>'))],
      'evil.jpg',
      { type: 'image/jpeg' },
    );
    const fd = buildUploadFormData(event.share_code, {
      guestName: 'Guest',
      files: [evil],
    });
    await expect(uploadGuestPhotosAction(fd)).rejects.toThrow(/not a valid image|unsupported/i);

    // Side-effect check: no photo row created.
    const sb = createServiceClient();
    const { count } = await sb
      .from('photos')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', event.id);
    expect(count).toBe(0);
  });

  it('happy path (anonymous guest) creates a row with status=approved and a delete_token', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id);

    const fd = buildUploadFormData(event.share_code, {
      guestName: 'Alice',
      guestEmail: 'alice@photomarkt.test',
      files: [await makeJpegFile()],
    });
    const result = await uploadGuestPhotosAction(fd);
    expect(result.uploadedCount).toBe(1);
    expect(result.status).toBe('approved');
    expect(result.uploads).toHaveLength(1);
    expect(result.uploads[0]?.deleteToken).toBeTruthy();

    const sb = createServiceClient();
    const { data: row } = await sb
      .from('photos')
      .select('upload_status, guest_name, guest_email, uploaded_by, delete_token, user_id')
      .eq('id', result.uploads[0]!.photoId)
      .single();
    expect(row?.upload_status).toBe('approved');
    expect(row?.guest_name).toBe('Alice');
    expect(row?.guest_email).toBe('alice@photomarkt.test');
    expect(row?.uploaded_by).toBeNull();
    expect(row?.delete_token).toBe(result.uploads[0]!.deleteToken);
    // Photo's owner is the event owner (revenue routes to them).
    expect(row?.user_id).toBe(photographer.id);
  });

  it('flags photos as pending when require_upload_approval=true', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id, { require_upload_approval: true });

    const fd = buildUploadFormData(event.share_code, {
      guestName: 'Bob',
      files: [await makeJpegFile()],
    });
    const result = await uploadGuestPhotosAction(fd);
    expect(result.status).toBe('pending');

    const sb = createServiceClient();
    const { data: row } = await sb
      .from('photos')
      .select('upload_status')
      .eq('id', result.uploads[0]!.photoId)
      .single();
    expect(row?.upload_status).toBe('pending');
  });

  it('records uploaded_by when the contributor is authenticated', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id);
    const contributor = await createTestUser('TALENT');

    mockSession.userId = contributor.id;
    const fd = buildUploadFormData(event.share_code, {
      // No guestName — authenticated users skip the name/email branch.
      files: [await makeJpegFile()],
    });
    const result = await uploadGuestPhotosAction(fd);

    const sb = createServiceClient();
    const { data: row } = await sb
      .from('photos')
      .select('uploaded_by, guest_name, guest_email')
      .eq('id', result.uploads[0]!.photoId)
      .single();
    expect(row?.uploaded_by).toBe(contributor.id);
    expect(row?.guest_name).toBeNull();
    expect(row?.guest_email).toBeNull();
  });
});

// ─── deleteContributorPhotoAction ─────────────────────────────────────────────

describe('deleteContributorPhotoAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  async function seedGuestPhoto(
    photographerId: string,
    options: { uploadedBy?: string | null; deleteToken?: string } = {},
  ) {
    const event = await makeCollabEvent(photographerId);
    const sb = createServiceClient();
    const deleteToken = options.deleteToken ?? crypto.randomUUID();
    const { data: photo, error } = await sb
      .from('photos')
      .insert({
        user_id: photographerId,
        event_id: event.id,
        uploaded_by: options.uploadedBy ?? null,
        guest_name: options.uploadedBy ? null : 'Anon',
        original_url: `collaborative/${event.id}/${crypto.randomUUID()}.jpg`,
        upload_status: 'approved',
        delete_token: deleteToken,
        taken_at: new Date().toISOString(),
      })
      .select('id, delete_token')
      .single();
    if (error || !photo) throw new Error(`seedGuestPhoto: ${error?.message}`);
    return { event, photoId: photo.id, deleteToken: photo.delete_token as string };
  }

  it('rejects when photoId or shareCode is missing', async () => {
    await expect(deleteContributorPhotoAction({ photoId: '', shareCode: 'X' })).rejects.toThrow(
      /missing photo or event/i,
    );
    await expect(deleteContributorPhotoAction({ photoId: 'X', shareCode: '' })).rejects.toThrow(
      /missing photo or event/i,
    );
  });

  it('rejects when the event does not exist (wrong share_code)', async () => {
    await expect(
      deleteContributorPhotoAction({
        photoId: '00000000-0000-0000-0000-000000000000',
        shareCode: 'NOEVENT1',
      }),
    ).rejects.toThrow(/event not found/i);
  });

  it('rejects when the photo does not belong to the event', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await makeCollabEvent(photographer.id);
    // Photo on a DIFFERENT event.
    const otherEvent = await createTestEvent(photographer.id);
    const sb = createServiceClient();
    const { data: stray } = await sb
      .from('photos')
      .insert({
        user_id: photographer.id,
        event_id: otherEvent.id,
        original_url: 'photos/stray.jpg',
        taken_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    await expect(
      deleteContributorPhotoAction({ photoId: stray!.id, shareCode: event.share_code }),
    ).rejects.toThrow(/photo not found/i);
  });

  it('allows the event OWNER (authenticated) to delete any contribution', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const { event, photoId } = await seedGuestPhoto(photographer.id);

    mockSession.userId = photographer.id;
    const result = await deleteContributorPhotoAction({ photoId, shareCode: event.share_code });
    expect(result.success).toBe(true);

    const sb = createServiceClient();
    const { data } = await sb.from('photos').select('id').eq('id', photoId).maybeSingle();
    expect(data).toBeNull();
  });

  it('allows the authenticated UPLOADER to delete their own contribution', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const contributor = await createTestUser('TALENT');
    const { event, photoId } = await seedGuestPhoto(photographer.id, {
      uploadedBy: contributor.id,
    });

    mockSession.userId = contributor.id;
    const result = await deleteContributorPhotoAction({ photoId, shareCode: event.share_code });
    expect(result.success).toBe(true);
  });

  it('allows an anonymous guest with the matching deleteToken', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const { event, photoId, deleteToken } = await seedGuestPhoto(photographer.id);

    // Unauthenticated, but armed with the token returned at upload time.
    mockSession.userId = null;
    const result = await deleteContributorPhotoAction({
      photoId,
      shareCode: event.share_code,
      deleteToken,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an anonymous guest with the WRONG deleteToken', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const { event, photoId } = await seedGuestPhoto(photographer.id);

    mockSession.userId = null;
    await expect(
      deleteContributorPhotoAction({
        photoId,
        shareCode: event.share_code,
        deleteToken: 'definitely-not-the-real-token',
      }),
    ).rejects.toThrow(/not authorized/i);

    // Photo still there.
    const sb = createServiceClient();
    const { data } = await sb.from('photos').select('id').eq('id', photoId).maybeSingle();
    expect(data?.id).toBe(photoId);
  });

  it('rejects an anonymous guest with NO deleteToken', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const { event, photoId } = await seedGuestPhoto(photographer.id);

    mockSession.userId = null;
    await expect(
      deleteContributorPhotoAction({ photoId, shareCode: event.share_code }),
    ).rejects.toThrow(/not authorized/i);
  });

  it('rejects an unrelated authenticated user (not owner, not uploader)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('TALENT');
    const { event, photoId } = await seedGuestPhoto(photographer.id);

    mockSession.userId = attacker.id;
    await expect(
      deleteContributorPhotoAction({ photoId, shareCode: event.share_code }),
    ).rejects.toThrow(/not authorized/i);
  });
});
