/**
 * Integration tests for the T-034 anti-abuse / cost controls on the anonymous
 * face-search Server Action (`searchFacesInEvent`).
 *
 * Strategy:
 *   - AWS `searchFacesByImage` is mocked so no test hits real AWS and we can
 *     assert precisely when it is (not) called — the whole point of the cost
 *     tiers is to gate that billable call.
 *   - The alert email module is mocked to assert the 50% alert fires exactly
 *     once per day-window.
 *   - `getFaceSearchLimits` is partially mocked with small caps + an alert
 *     recipient so the breakers can be tripped without seeding thousands of
 *     rows. The real key builders / window constant / AWS-call constant are
 *     preserved (spread from the actual module) so tests seed the exact same
 *     buckets the code reads.
 *   - Counters hit the local Supabase via the real atomic RPCs, so the
 *     increment-before-AWS + window semantics exercise real DB I/O.
 */

import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSearchFacesByImage, mockSendAlert, TEST_GLOBAL_CAP, TEST_EVENT_CAP } = vi.hoisted(
  () => ({
    mockSearchFacesByImage: vi.fn(),
    mockSendAlert: vi.fn(),
    TEST_GLOBAL_CAP: 10,
    TEST_EVENT_CAP: 4,
  }),
);

vi.mock('@/lib/aws/face-indexing', () => ({
  searchFacesByImage: mockSearchFacesByImage,
}));

vi.mock('@/lib/email/send-face-search-alert', () => ({
  sendFaceSearchAlertEmail: mockSendAlert,
}));

vi.mock('@/lib/face-search-limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/face-search-limits')>();
  return {
    ...actual,
    getFaceSearchLimits: () => ({
      globalDailyCalls: TEST_GLOBAL_CAP,
      eventDailyCalls: TEST_EVENT_CAP,
      alertEmail: 'alerts@example.com',
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

import {
  searchFacesInEvent,
  searchPhotosByBibInEvent,
} from '@/app/[lang]/events/[shareCode]/actions';
import { persistPhotoBibs, updateEventBibDetectionState } from '@/database/queries/bib-numbers';
import {
  AWS_CALLS_PER_FACE_SEARCH,
  eventDailyKey,
  FACE_SEARCH_DAILY_WINDOW_SEC,
  globalDailyKey,
} from '@/lib/face-search-limits';
import { computeWindow } from '@/lib/rate-limit';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function makeSelfieJpeg(): Promise<File> {
  const buf = await sharp({
    create: { width: 320, height: 320, channels: 3, background: '#3377aa' },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(buf)], 'selfie.jpg', { type: 'image/jpeg' });
}

function selfieForm(file: File): FormData {
  const fd = new FormData();
  fd.append('selfie', file);
  return fd;
}

async function makeAiEvent(shareCode: string): Promise<{ id: string; shareCode: string }> {
  const owner = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(owner.id, { share_code: shareCode, is_public: true });
  const sb = createServiceClient();
  const { error } = await sb
    .from('events')
    .update({
      ai_matching_enabled: true,
      ai_matching_status: 'ready',
      rekognition_collection_id: `photomarkt-test-${shareCode}`,
      rekognition_region: 'eu-west-1',
      contains_minors: false,
    })
    .eq('id', event.id);
  if (error) throw new Error(`makeAiEvent: ${error.message}`);
  return { id: event.id, shareCode };
}

/** Insert an approved photo + a linked photo_faces row so AWS matches map to it. */
async function insertPhotoWithFace(eventId: string, awsFaceId: string): Promise<string> {
  const sb = createServiceClient();
  const { data: ev } = await sb.from('events').select('user_id').eq('id', eventId).single();
  const ownerId = (ev as { user_id: string }).user_id;
  const { data: photo, error: photoErr } = await sb
    .from('photos')
    .insert({
      user_id: ownerId,
      event_id: eventId,
      original_url: `${ownerId}/${eventId}/${crypto.randomUUID()}.jpg`,
      taken_at: new Date().toISOString(),
      city: 'Barcelona',
      country: 'ES',
      state: 'Catalonia',
      upload_status: 'approved',
      face_index_status: 'indexed',
    })
    .select('id')
    .single();
  if (photoErr || !photo) throw new Error(`insertPhoto: ${photoErr?.message ?? 'no data'}`);
  const { error: faceErr } = await sb.from('photo_faces').insert({
    photo_id: photo.id,
    aws_face_id: awsFaceId,
    aws_collection_id: `photomarkt-test-${eventId}`,
    confidence: 99.9,
    bounding_box: { Width: 0.4, Height: 0.5, Left: 0.3, Top: 0.2 },
  });
  if (faceErr) throw new Error(`insertFace: ${faceErr.message}`);
  return photo.id as string;
}

/** Seed a rate-limit bucket at `count` for the day-window containing `whenMs`. */
async function seedBucket(key: string, count: number, whenMs: number = Date.now()): Promise<void> {
  const { start } = computeWindow(whenMs, FACE_SEARCH_DAILY_WINDOW_SEC);
  const sb = createServiceClient();
  const { error } = await sb
    .from('rate_limit_buckets')
    .insert({ bucket_key: key, window_start: start.toISOString(), count });
  if (error) throw new Error(`seedBucket: ${error.message}`);
}

async function readBucketCount(key: string, whenMs: number = Date.now()): Promise<number | null> {
  const { start } = computeWindow(whenMs, FACE_SEARCH_DAILY_WINDOW_SEC);
  const sb = createServiceClient();
  const { data } = await sb
    .from('rate_limit_buckets')
    .select('count')
    .eq('bucket_key', key)
    .eq('window_start', start.toISOString())
    .maybeSingle();
  return data ? (data as { count: number }).count : null;
}

describe('searchFacesInEvent cost controls (T-034)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSearchFacesByImage.mockReset();
    mockSendAlert.mockReset();
  });

  it('global circuit breaker: at cap → temporarily-unavailable, AWS never called', async () => {
    const event = await makeAiEvent('GLOB01');
    await seedBucket(globalDailyKey(), TEST_GLOBAL_CAP);

    await expect(
      searchFacesInEvent(event.shareCode, selfieForm(await makeSelfieJpeg())),
    ).rejects.toThrow(/RATE_LIMIT:face-search:unavailable/);
    expect(mockSearchFacesByImage).not.toHaveBeenCalled();
  });

  it('per-event cap trips only that event; a different event still searches', async () => {
    const blocked = await makeAiEvent('EVTBLK');
    const open = await makeAiEvent('EVTOK');
    const faceId = 'aws-face-open';
    const openPhotoId = await insertPhotoWithFace(open.id, faceId);
    mockSearchFacesByImage.mockResolvedValue([{ awsFaceId: faceId, similarity: 97 }]);

    // Event A's per-event daily counter is already maxed.
    await seedBucket(eventDailyKey(blocked.id), TEST_EVENT_CAP);

    await expect(
      searchFacesInEvent(blocked.shareCode, selfieForm(await makeSelfieJpeg())),
    ).rejects.toThrow(/RATE_LIMIT:face-search:unavailable/);
    // The blocked event never reached AWS…
    expect(mockSearchFacesByImage).not.toHaveBeenCalled();

    // …and a different event, under its own caps, searches normally.
    const result = await searchFacesInEvent(open.shareCode, selfieForm(await makeSelfieJpeg()));
    expect(result.matches.map((m) => m.photoId)).toEqual([openPhotoId]);
    expect(mockSearchFacesByImage).toHaveBeenCalledTimes(1);
  });

  it('a successful search increments the per-event and global daily counters by the AWS-call count', async () => {
    const event = await makeAiEvent('COUNT1');
    const faceId = 'aws-face-count';
    await insertPhotoWithFace(event.id, faceId);
    mockSearchFacesByImage.mockResolvedValue([{ awsFaceId: faceId, similarity: 97 }]);

    await searchFacesInEvent(event.shareCode, selfieForm(await makeSelfieJpeg()));

    expect(await readBucketCount(eventDailyKey(event.id))).toBe(AWS_CALLS_PER_FACE_SEARCH);
    expect(await readBucketCount(globalDailyKey())).toBe(AWS_CALLS_PER_FACE_SEARCH);
  });

  it("window reset: a previous day's maxed global counter does not block today", async () => {
    const event = await makeAiEvent('RESET1');
    const faceId = 'aws-face-reset';
    const photoId = await insertPhotoWithFace(event.id, faceId);
    mockSearchFacesByImage.mockResolvedValue([{ awsFaceId: faceId, similarity: 97 }]);

    // Yesterday's global window is at cap; today's window starts empty.
    const yesterdayMs = Date.now() - FACE_SEARCH_DAILY_WINDOW_SEC * 1000;
    await seedBucket(globalDailyKey(), TEST_GLOBAL_CAP, yesterdayMs);

    const result = await searchFacesInEvent(event.shareCode, selfieForm(await makeSelfieJpeg()));
    expect(result.matches.map((m) => m.photoId)).toEqual([photoId]);
    expect(mockSearchFacesByImage).toHaveBeenCalledTimes(1);
  });

  it('fires the 50%-of-global alert exactly once per day-window', async () => {
    const event = await makeAiEvent('ALERT1');
    const faceId = 'aws-face-alert';
    await insertPhotoWithFace(event.id, faceId);
    mockSearchFacesByImage.mockResolvedValue([{ awsFaceId: faceId, similarity: 97 }]);

    // Seed one below 50% (ceil(10/2) = 5): the first search crosses it.
    await seedBucket(globalDailyKey(), 4);

    await searchFacesInEvent(event.shareCode, selfieForm(await makeSelfieJpeg()));
    await searchFacesInEvent(event.shareCode, selfieForm(await makeSelfieJpeg()));

    expect(mockSendAlert).toHaveBeenCalledTimes(1);
    expect(mockSendAlert).toHaveBeenCalledWith({
      to: 'alerts@example.com',
      currentCalls: 5,
      cap: TEST_GLOBAL_CAP,
    });
  });

  it('releases the alert claim when the email send fails, so a later request retries', async () => {
    const event = await makeAiEvent('ALERT2');
    const faceId = 'aws-face-alert2';
    await insertPhotoWithFace(event.id, faceId);
    mockSearchFacesByImage.mockResolvedValue([{ awsFaceId: faceId, similarity: 97 }]);
    // First send throws (transient Resend blip); the retry succeeds.
    mockSendAlert.mockRejectedValueOnce(new Error('resend blip'));
    mockSendAlert.mockResolvedValue(undefined);

    await seedBucket(globalDailyKey(), 4);

    // Search #1 crosses 50%, claims, send throws → claim released.
    await searchFacesInEvent(event.shareCode, selfieForm(await makeSelfieJpeg()));
    // Search #2 re-claims (row was released) and sends successfully.
    await searchFacesInEvent(event.shareCode, selfieForm(await makeSelfieJpeg()));

    // Without the release, the second attempt would be deduped away (called once).
    expect(mockSendAlert).toHaveBeenCalledTimes(2);
  });

  it('bib search keeps working when the face-search breaker is open', async () => {
    const event = await makeAiEvent('BIBOK');
    const sb = createServiceClient();
    await updateEventBibDetectionState(sb, event.id, { enabled: true });
    const photo = await createTestPhoto(event.id);
    await persistPhotoBibs(sb, photo.id, [{ bibText: '1432', confidence: 99 }]);

    // Trip the global face-search breaker.
    await seedBucket(globalDailyKey(), TEST_GLOBAL_CAP);

    await expect(
      searchFacesInEvent(event.shareCode, selfieForm(await makeSelfieJpeg())),
    ).rejects.toThrow(/RATE_LIMIT:face-search:unavailable/);

    // Bib search is a separate, non-AWS path — unaffected.
    const bib = await searchPhotosByBibInEvent(event.shareCode, '1432');
    expect(bib.photoIds).toEqual([photo.id]);
  });
});
