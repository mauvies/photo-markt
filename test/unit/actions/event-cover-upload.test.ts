/**
 * Unit tests for the event-cover upload actions (T-238).
 *
 * The reported bug was a platform 413: the cover bytes travelled inside a Server
 * Action and Vercel refuses any function body over 4.5 MB. The fix splits the flow
 * in two — mint a signed upload URL, let the browser PUT the bytes to Storage, then
 * adopt the stored object — which moves two guarantees that used to be automatic:
 *
 *   1. **Validation.** `validatePhotoUpload` could run before the write when the
 *      bytes passed through the action. It now runs on the object read back from
 *      Storage, and a non-image must be DELETED rather than left in the bucket.
 *   2. **Ownership of the path.** The action used to build the storage path itself.
 *      It still does at mint time, but attach takes a client-supplied path — so a
 *      forged one must never be adopted as an event's cover.
 *
 * Both are asserted here; the first two tests also fail against the pre-fix tree,
 * where neither action existed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  supabaseMock,
  adminMock,
  setEventCoverPathMock,
  createSignedUploadUrlMock,
  deleteStorageFilesMock,
  validatePhotoBufferMock,
  downloadMock,
} = vi.hoisted(() => ({
  supabaseMock: { auth: { getUser: vi.fn() }, from: vi.fn() },
  adminMock: { storage: { from: vi.fn() } },
  setEventCoverPathMock: vi.fn(),
  createSignedUploadUrlMock: vi.fn(),
  deleteStorageFilesMock: vi.fn(),
  validatePhotoBufferMock: vi.fn(),
  downloadMock: vi.fn(),
}));

vi.mock('@/database/server', () => ({ createClient: vi.fn(async () => supabaseMock) }));
vi.mock('@/database/supabase-admin', () => ({ supabaseAdmin: adminMock }));
vi.mock('@/database/queries/events', () => ({
  setEventCoverPath: (...args: unknown[]) => setEventCoverPathMock(...args),
}));
vi.mock('@/database/queries/storage', () => ({
  createSignedUploadUrl: (...args: unknown[]) => createSignedUploadUrlMock(...args),
  deleteStorageFiles: (...args: unknown[]) => deleteStorageFilesMock(...args),
}));
vi.mock('@/lib/photo-upload', () => ({
  validatePhotoBuffer: (...args: unknown[]) => validatePhotoBufferMock(...args),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

import {
  attachEventCoverAction,
  createEventCoverUploadUrlAction,
} from '@/app/[lang]/dashboard/photographer/events/new/actions';

const OWNER = 'owner-1';
const EVENT = 'event-1';

/** Drive the two `.maybeSingle()` reads the actions make: the event row (ownership
 *  + current cover) and the profile row (`revalidateAfterEventCreate`). */
function stubTables(event: Record<string, unknown> | null) {
  supabaseMock.from.mockImplementation((table: string) => {
    const row = table === 'events' ? event : { slug: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      maybeSingle: async () => ({ data: row, error: null }),
    };
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: OWNER } }, error: null });
  stubTables({ id: EVENT, user_id: OWNER, cover_path: null });
  createSignedUploadUrlMock.mockImplementation(async (_c: unknown, _b: string, path: string) => ({
    path,
    token: 'tok',
    signedUrl: `https://storage.test/${path}?token=tok`,
  }));
  adminMock.storage.from.mockReturnValue({ download: downloadMock });
  downloadMock.mockResolvedValue({
    data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
    error: null,
  });
  validatePhotoBufferMock.mockResolvedValue({ contentType: 'image/jpeg', extension: 'jpg' });
});

describe('createEventCoverUploadUrlAction', () => {
  it('mints a signed upload URL under the owner’s own event folder', async () => {
    const result = await createEventCoverUploadUrlAction(EVENT, 'my holiday shot.JPG');

    expect(result.path.startsWith(`${OWNER}/${EVENT}/cover-`)).toBe(true);
    expect(result.path.endsWith('.jpg')).toBe(true);
    expect(result.signedUrl).toContain(result.path);
  });

  it('never lets the client dictate the path', async () => {
    // The filename is a hint for the extension and nothing more — the folder, the
    // `cover-` prefix and the uuid are all server-generated, so a name crafted to
    // climb out of the event folder can't.
    for (const filename of ['../../etc/passwd', 'no-extension', 'weird.name with spaces']) {
      const result = await createEventCoverUploadUrlAction(EVENT, filename);
      expect(result.path.startsWith(`${OWNER}/${EVENT}/cover-`)).toBe(true);
      expect(result.path).not.toContain('..');
      // Anything that isn't a short alphanumeric token becomes the safe default;
      // the real format is settled from the bytes at attach time regardless.
      expect(result.path.endsWith('.jpg')).toBe(true);
    }
  });

  it('refuses an event the caller does not own', async () => {
    stubTables({ id: EVENT, user_id: 'someone-else', cover_path: null });
    await expect(createEventCoverUploadUrlAction(EVENT, 'a.jpg')).rejects.toThrow(
      /not found or access denied/i,
    );
    expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
  });
});

describe('attachEventCoverAction', () => {
  it('validates the stored bytes before adopting them as the cover', async () => {
    const path = `${OWNER}/${EVENT}/cover-abc.jpg`;
    await attachEventCoverAction(EVENT, path);

    expect(validatePhotoBufferMock).toHaveBeenCalledTimes(1);
    expect(setEventCoverPathMock).toHaveBeenCalledWith(supabaseMock, EVENT, OWNER, path);
  });

  it('deletes the uploaded object when the bytes are not an image', async () => {
    validatePhotoBufferMock.mockRejectedValue(new Error('File is not a valid image.'));
    const path = `${OWNER}/${EVENT}/cover-abc.jpg`;

    await expect(attachEventCoverAction(EVENT, path)).rejects.toThrow(/not a valid image/i);

    // The renamed `.exe` must not survive in the bucket just because validation
    // moved to after the upload.
    expect(deleteStorageFilesMock).toHaveBeenCalledWith(adminMock, 'photos', [path]);
    expect(setEventCoverPathMock).not.toHaveBeenCalled();
  });

  it('refuses a path outside the caller’s own event folder', async () => {
    const foreign = 'another-photographer/another-event/cover-abc.jpg';

    await expect(attachEventCoverAction(EVENT, foreign)).rejects.toThrow(/invalid cover path/i);

    // Nothing read, nothing written, and — crucially — nothing DELETED: a forged
    // path must not become a way to destroy someone else's object either.
    expect(downloadMock).not.toHaveBeenCalled();
    expect(deleteStorageFilesMock).not.toHaveBeenCalled();
    expect(setEventCoverPathMock).not.toHaveBeenCalled();
  });

  it('removes the previous cover object on replace', async () => {
    const previous = `${OWNER}/${EVENT}/cover-old.jpg`;
    stubTables({ id: EVENT, user_id: OWNER, cover_path: previous });
    const path = `${OWNER}/${EVENT}/cover-new.jpg`;

    await attachEventCoverAction(EVENT, path);

    expect(setEventCoverPathMock).toHaveBeenCalledWith(supabaseMock, EVENT, OWNER, path);
    expect(deleteStorageFilesMock).toHaveBeenCalledWith(supabaseMock, 'photos', [previous]);
  });
});
