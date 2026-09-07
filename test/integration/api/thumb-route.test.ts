/**
 * Integration tests for `app/api/thumb/[...path]/route.ts`.
 *
 * Strategy: call the GET handler directly (no HTTP server needed).
 * Uses the local Supabase storage (Docker) to upload a real WebP fixture
 * so the route can download it. Verifies:
 *   - Valid stored thumb → 200 with correct headers
 *   - Missing object → 404 (fail-closed)
 *   - Path traversal / invalid path → 400
 *   - Path without 'thumbs' segment → 400
 *   - Path with wrong final segment → 400
 *   - T-221: over the per-IP hourly cap → 429 with Retry-After, never cached
 */

import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/thumb/[...path]/route';
import { computeWindow } from '@/lib/rate-limit';
import {
  createServiceClient,
  LOCAL_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL,
} from '../../helpers/supabase-test-client';

// The route handler calls `process.env.SUPABASE_SERVICE_ROLE_KEY` and
// `env.NEXT_PUBLIC_SUPABASE_URL`. Point both at the local test stack.
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LOCAL_SERVICE_ROLE_KEY);
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', LOCAL_SUPABASE_URL);

// next/cache helpers require Next.js render context — replace with no-ops.
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

const BUCKET = 'photos';
const TEST_THUMB_PATH = 'test-user/test-event/thumbs/test-photo/small.webp';

// A fresh IP per request keeps each test in its own rate-limit bucket, so they
// don't consume one another's budget (buckets persist in the local DB).
async function makeRequest(pathSegments: string[], ip = crypto.randomUUID()) {
  const req = new NextRequest(`http://localhost/api/thumb/${pathSegments.join('/')}`, {
    headers: { 'x-real-ip': ip },
  });
  return GET(req, { params: Promise.resolve({ path: pathSegments }) });
}

describe('/api/thumb route', () => {
  let uploadedWebpBytes: Buffer;

  beforeAll(async () => {
    // Generate a minimal WebP fixture
    uploadedWebpBytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 120, g: 100, b: 80 } },
    })
      .webp({ quality: 60 })
      .toBuffer();

    // Upload it to local storage so the route can fetch it
    const sb = createServiceClient();
    await sb.storage.from(BUCKET).upload(TEST_THUMB_PATH, uploadedWebpBytes, {
      contentType: 'image/webp',
      upsert: true,
    });
  });

  afterAll(async () => {
    // Clean up fixture
    const sb = createServiceClient();
    await sb.storage.from(BUCKET).remove([TEST_THUMB_PATH]);
  });

  it('serves a stored WebP thumbnail with immutable cache headers', async () => {
    const segments = TEST_THUMB_PATH.split('/');
    const res = await makeRequest(segments);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toContain('immutable');
    expect(cc).toContain('s-maxage=31536000');

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it('returns 404 for a missing object (fail-closed)', async () => {
    const segments = ['test-user', 'test-event', 'thumbs', 'nonexistent', 'small.webp'];
    const res = await makeRequest(segments);
    expect(res.status).toBe(404);
  });

  it('returns 400 for a path traversal attempt (..)', async () => {
    const res = await makeRequest(['test-user', '..', 'thumbs', 'uuid', 'small.webp']);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a path with empty segment', async () => {
    const res = await makeRequest(['test-user', '', 'thumbs', 'uuid', 'small.webp']);
    expect(res.status).toBe(400);
  });

  it('returns 400 when path has fewer than 5 segments', async () => {
    const res = await makeRequest(['thumbs', 'uuid', 'small.webp']);
    expect(res.status).toBe(400);
  });

  it('returns 400 when path does not contain thumbs segment', async () => {
    const res = await makeRequest([
      'test-user',
      'test-event',
      'nothumbs',
      'uuid',
      'small.webp',
      'x',
    ]);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-webp final segment', async () => {
    const res = await makeRequest(['test-user', 'test-event', 'thumbs', 'uuid', 'original.jpg']);
    expect(res.status).toBe(400);
  });

  describe('per-IP rate limit (T-221)', () => {
    // Mirrors the watermark suite: `THUMB_RATE_LIMIT.limit` is module-private,
    // so the cap is restated here — a change to it must be a deliberate edit in
    // both places.
    const LIMIT = 6000;

    // Freeze the clock so the window the seed writes and the one the route
    // computes are identical — otherwise a seed + request straddling a
    // top-of-hour boundary would land in different windows and flake.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-07-10T12:30:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function seedBucket(ip: string, count: number) {
      const { start } = computeWindow(Date.now(), 3600);
      await createServiceClient()
        .from('rate_limit_buckets')
        .insert({ bucket_key: `thumb:${ip}`, window_start: start.toISOString(), count });
    }

    it('answers 429 with Retry-After (never cached) once over the cap', async () => {
      const ip = crypto.randomUUID();
      await seedBucket(ip, LIMIT); // route increments to LIMIT+1 → over the cap

      const res = await makeRequest(TEST_THUMB_PATH.split('/'), ip);

      expect(res.status).toBe(429);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(res.headers.get('cache-control') ?? '').toContain('no-store');
    });

    it('serves normally while under the per-IP cap', async () => {
      const ip = crypto.randomUUID();
      await seedBucket(ip, LIMIT - 1); // route increments to LIMIT → still within

      const res = await makeRequest(TEST_THUMB_PATH.split('/'), ip);
      expect(res.status).toBe(200);
    });
  });
});
