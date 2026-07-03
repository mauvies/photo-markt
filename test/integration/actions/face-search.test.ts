/**
 * Integration tests for the talent-side face search Server Action
 * `searchFacesInEvent` in `app/[lang]/events/[shareCode]/actions.ts`.
 *
 * Mocking strategy:
 *   - AWS SDK calls go through `searchFacesByImage` in `lib/aws/face-indexing.ts`.
 *     We mock that module to return predetermined `SearchedFace[]` so the test
 *     never hits real AWS. This lets us pin the exact similarities → buckets
 *     mapping.
 *   - The other dependencies (Supabase Storage selfie validation, event +
 *     photo_faces queries) hit the local Supabase via the test helpers, so
 *     the bucket-mapping + orphan-filter logic exercises real DB I/O.
 *
 * Coverage:
 *   - Bucketing: 97 → very-likely, 88 → likely, 82 → possibly
 *   - Orphan filtering: AWS returns a face_id that has no `photo_faces` row
 *   - Buffer-leak guard: no console.* call after a (mocked) search contains
 *     a base64 fragment, a long string, or anything resembling photo bytes.
 *     This is the same pattern that caught the worker `output_too_large`
 *     class in PR 2.
 */

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AWS mock — vi.hoisted runs before any imports, so the mock fn exists by
// the time vi.mock's factory references it.
const { mockSearchFacesByImage } = vi.hoisted(() => ({
  mockSearchFacesByImage: vi.fn(),
}));
vi.mock('@/lib/aws/face-indexing', () => ({
  searchFacesByImage: mockSearchFacesByImage,
}));

vi.mock('@/database/server', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    createClient: vi.fn(async () => {
      return createClient(
        'http://127.0.0.1:54321',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
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
  headers: vi.fn(
    async () => new Headers({ host: '127.0.0.1:3000', 'x-forwarded-for': '10.0.0.1' }),
  ),
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
    getAll: vi.fn(() => []),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

import { searchFacesInEvent } from '@/app/[lang]/events/[shareCode]/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function makeSelfieJpeg(): Promise<File> {
  const buf = await sharp({
    create: { width: 320, height: 320, channels: 3, background: '#cc6677' },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(buf)], 'selfie.jpg', { type: 'image/jpeg' });
}

async function enableAiMatchingOnEvent(
  eventId: string,
  collectionId = 'photomarkt-test-collection',
): Promise<void> {
  const sb = createServiceClient();
  const { error } = await sb
    .from('events')
    .update({
      ai_matching_enabled: true,
      ai_matching_status: 'ready',
      rekognition_collection_id: collectionId,
      rekognition_region: 'eu-west-1',
      contains_minors: false,
    })
    .eq('id', eventId);
  if (error) throw new Error(`enableAiMatchingOnEvent: ${error.message}`);
}

async function insertPhotoWithFace(args: {
  eventId: string;
  ownerId: string;
  awsFaceId: string;
  awsCollectionId: string;
  uploadStatus?: 'approved' | 'pending' | 'rejected';
}): Promise<{ photoId: string }> {
  const sb = createServiceClient();
  // Photo row (must be approved to show up in getEventPhotosPublic).
  const { data: photo, error: photoErr } = await sb
    .from('photos')
    .insert({
      user_id: args.ownerId,
      event_id: args.eventId,
      original_url: `${args.ownerId}/${args.eventId}/${crypto.randomUUID()}.jpg`,
      taken_at: new Date().toISOString(),
      city: 'Barcelona',
      country: 'ES',
      state: 'Catalonia',
      upload_status: args.uploadStatus ?? 'approved',
      face_index_status: 'indexed',
    })
    .select('id')
    .single();
  if (photoErr || !photo) throw new Error(`insertPhoto: ${photoErr?.message ?? 'no data'}`);

  // Linked photo_faces row.
  const { error: faceErr } = await sb.from('photo_faces').insert({
    photo_id: photo.id,
    aws_face_id: args.awsFaceId,
    aws_collection_id: args.awsCollectionId,
    confidence: 99.9,
    bounding_box: { Width: 0.4, Height: 0.5, Left: 0.3, Top: 0.2 },
  });
  if (faceErr) throw new Error(`insertFace: ${faceErr.message}`);
  return { photoId: photo.id as string };
}

describe('searchFacesInEvent', () => {
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
  let capturedLogs: Array<{ method: string; args: unknown[] }>;

  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSearchFacesByImage.mockReset();

    capturedLogs = [];
    consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        capturedLogs.push({ method, args });
      }),
    );
  });

  afterEach(() => {
    for (const spy of consoleSpies) spy.mockRestore();
  });

  it('bucketed matches: similarities 97 / 88 / 82 → very-likely / likely / possibly', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { share_code: 'SHARE001' });
    const collectionId = 'photomarkt-test-bucketing';
    await enableAiMatchingOnEvent(event.id, collectionId);

    const veryLikely = await insertPhotoWithFace({
      eventId: event.id,
      ownerId: owner.id,
      awsFaceId: 'aws-face-vl',
      awsCollectionId: collectionId,
    });
    const likely = await insertPhotoWithFace({
      eventId: event.id,
      ownerId: owner.id,
      awsFaceId: 'aws-face-l',
      awsCollectionId: collectionId,
    });
    const possibly = await insertPhotoWithFace({
      eventId: event.id,
      ownerId: owner.id,
      awsFaceId: 'aws-face-p',
      awsCollectionId: collectionId,
    });

    // AWS returns 3 real matches + 1 orphan (face_id with no photo_faces row).
    mockSearchFacesByImage.mockResolvedValueOnce([
      { awsFaceId: 'aws-face-vl', similarity: 97 },
      { awsFaceId: 'aws-face-l', similarity: 88 },
      { awsFaceId: 'aws-face-p', similarity: 82 },
      { awsFaceId: 'aws-face-orphan', similarity: 90 },
    ]);

    const formData = new FormData();
    formData.append('selfie', await makeSelfieJpeg());

    const result = await searchFacesInEvent(event.share_code ?? '', formData);

    expect(result.reason).toBeUndefined();
    expect(result.matches).toHaveLength(3);

    const byPhotoId = new Map(result.matches.map((m) => [m.photoId, m]));
    expect(byPhotoId.get(veryLikely.photoId)?.bucket).toBe('very-likely');
    expect(byPhotoId.get(likely.photoId)?.bucket).toBe('likely');
    expect(byPhotoId.get(possibly.photoId)?.bucket).toBe('possibly');

    // Orphan AWS face_id is filtered out (no matching photo_faces row).
    expect(result.matches.find((m) => m.photoId === undefined)).toBeUndefined();
  });

  // Regression (T-062): public-only events have share_code = null and are
  // opened by their SEO slug. `searchFacesInEvent` used to resolve strictly by
  // share code, so slug lookups threw "Event not found." It must now resolve by
  // slug, exactly like the public event page does.
  it('resolves a public event by slug when it has no share code', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, {
      slug: 'face-public-slug',
      is_public: true,
    });
    // Model a public-only event: no share code, opened by slug.
    const sb = createServiceClient();
    await sb.from('events').update({ share_code: null }).eq('id', event.id);

    const collectionId = 'photomarkt-test-slug';
    await enableAiMatchingOnEvent(event.id, collectionId);

    const match = await insertPhotoWithFace({
      eventId: event.id,
      ownerId: owner.id,
      awsFaceId: 'aws-face-slug',
      awsCollectionId: collectionId,
    });

    mockSearchFacesByImage.mockResolvedValueOnce([{ awsFaceId: 'aws-face-slug', similarity: 97 }]);

    const formData = new FormData();
    formData.append('selfie', await makeSelfieJpeg());

    const result = await searchFacesInEvent('face-public-slug', formData);
    expect(result.reason).toBeUndefined();
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.photoId).toBe(match.photoId);
    expect(result.matches[0]?.bucket).toBe('very-likely');
  });

  it('returns empty matches array when AWS returns nothing', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { share_code: 'SHARE002' });
    await enableAiMatchingOnEvent(event.id);

    mockSearchFacesByImage.mockResolvedValueOnce([]);

    const formData = new FormData();
    formData.append('selfie', await makeSelfieJpeg());

    const result = await searchFacesInEvent(event.share_code ?? '', formData);
    expect(result.matches).toEqual([]);
    expect(result.reason).toBeUndefined();
  });

  it('returns reason=invalid-selfie when AWS throws InvalidParameterException', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { share_code: 'SHARE003' });
    await enableAiMatchingOnEvent(event.id);

    // Simulate AWS rejecting the selfie (no face / multiple faces).
    const awsErr = new Error('No face detected in image');
    awsErr.name = 'InvalidParameterException';
    mockSearchFacesByImage.mockRejectedValueOnce(awsErr);

    const formData = new FormData();
    formData.append('selfie', await makeSelfieJpeg());

    const result = await searchFacesInEvent(event.share_code ?? '', formData);
    expect(result.reason).toBe('invalid-selfie');
    expect(result.matches).toEqual([]);
  });

  it('rejects events where AI matching is not enabled', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { share_code: 'SHARE004' });
    // Intentionally NOT calling enableAiMatchingOnEvent.

    const formData = new FormData();
    formData.append('selfie', await makeSelfieJpeg());

    await expect(searchFacesInEvent(event.share_code ?? '', formData)).rejects.toThrow(
      /no longer supports face search/i,
    );
    expect(mockSearchFacesByImage).not.toHaveBeenCalled();
  });

  it('rejects invalid selfies (non-image bytes)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { share_code: 'SHARE005' });
    await enableAiMatchingOnEvent(event.id);

    // SVG bytes with image/jpeg MIME — passes client-side type check, fails
    // server-side magic-byte check (validatePhotoUpload + Sharp).
    const garbage = new File(
      [new Uint8Array(Buffer.from('<svg onload="alert(1)"></svg>', 'utf8'))],
      'evil.jpg',
      { type: 'image/jpeg' },
    );
    const formData = new FormData();
    formData.append('selfie', garbage);

    await expect(searchFacesInEvent(event.share_code ?? '', formData)).rejects.toThrow(
      /not a valid image/i,
    );
    expect(mockSearchFacesByImage).not.toHaveBeenCalled();
  });

  it('buffer-leak guard: no console output contains selfie bytes (base64 or raw)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { share_code: 'SHARE006' });
    await enableAiMatchingOnEvent(event.id);

    // Force the AWS call to throw an error with a fake bloated `cause` —
    // mimics AWS SDK v3's actual behavior where the request `Input` is
    // attached to errors. safeCall in the SA must strip this before any
    // logging or re-throw, or the buffer leaks.
    const fakeBufferB64 = 'SUDDEN_BLOAT_'.repeat(2000); // ~26 KB of junk
    const bloatedErr = new Error('AWS exploded') as Error & {
      $response?: { Image: { Bytes: string } };
    };
    bloatedErr.name = 'InternalServerError';
    bloatedErr.$response = { Image: { Bytes: fakeBufferB64 } };
    mockSearchFacesByImage.mockRejectedValueOnce(bloatedErr);

    const selfieFile = await makeSelfieJpeg();
    const formData = new FormData();
    formData.append('selfie', selfieFile);

    await expect(searchFacesInEvent(event.share_code ?? '', formData)).rejects.toThrow(
      /search failed/i,
    );

    // Pin: no console call after the SA returned should serialize the
    // fake bloated bytes — safeCall must drop them.
    const MAX_ARG_LEN = 1024;
    for (const { method, args } of capturedLogs) {
      for (const arg of args) {
        const repr = typeof arg === 'string' ? arg : JSON.stringify(arg ?? null);
        expect(repr.length, `console.${method} arg unexpectedly large`).toBeLessThan(MAX_ARG_LEN);
        expect(repr).not.toContain('SUDDEN_BLOAT_');
      }
    }
  });
});
