/**
 * Integration tests for `app/api/watermark/[...path]/route.ts`.
 *
 * Strategy: call the GET handler directly (no HTTP server needed), against
 * local Supabase storage (Docker) with a real JPEG fixture. Verifies:
 *   - Valid stored original → 200 watermarked JPEG with the 24h cache header
 *   - Missing object → 404 placeholder (fail-closed), never cached
 *   - Path traversal → 400
 *   - T-094: over the per-IP hourly cap → 429 with Retry-After, never cached
 */

import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/watermark/[...path]/route';
import { computeWindow } from '@/lib/rate-limit';
import {
  createServiceClient,
  LOCAL_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL,
} from '../../helpers/supabase-test-client';

// The route reads `process.env.SUPABASE_SERVICE_ROLE_KEY` and
// `env.NEXT_PUBLIC_SUPABASE_URL`. Point both at the local test stack.
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LOCAL_SERVICE_ROLE_KEY);
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', LOCAL_SUPABASE_URL);

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

const BUCKET = 'photos';
const TEST_PHOTO_PATH = 'test-user/test-event/wm-photo.jpg';

// A fresh IP per request keeps each test in its own rate-limit bucket, so they
// don't consume one another's budget (buckets persist in the local DB).
function makeRequest(pathSegments: string[], ip = crypto.randomUUID()) {
  const req = new NextRequest(`http://localhost/api/watermark/${pathSegments.join('/')}`, {
    headers: { 'x-real-ip': ip },
  });
  return GET(req, { params: Promise.resolve({ path: pathSegments }) });
}

describe('/api/watermark route', () => {
  beforeAll(async () => {
    const jpeg = await sharp({
      create: { width: 60, height: 40, channels: 3, background: { r: 90, g: 120, b: 150 } },
    })
      .jpeg({ quality: 70 })
      .toBuffer();

    const sb = createServiceClient();
    await sb.storage.from(BUCKET).upload(TEST_PHOTO_PATH, jpeg, {
      contentType: 'image/jpeg',
      upsert: true,
    });
  });

  afterAll(async () => {
    const sb = createServiceClient();
    await sb.storage.from(BUCKET).remove([TEST_PHOTO_PATH]);
  });

  it('serves a watermarked JPEG with the 24h cache header', async () => {
    const res = await makeRequest(TEST_PHOTO_PATH.split('/'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control') ?? '').toContain('max-age=86400');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it('returns a 404 placeholder for a missing object (fail-closed, no-store)', async () => {
    const res = await makeRequest(['test-user', 'test-event', 'nonexistent.jpg']);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control') ?? '').toContain('no-store');
  });

  it('returns 400 for a path traversal attempt (..)', async () => {
    const res = await makeRequest(['test-user', '..', 'photo.jpg']);
    expect(res.status).toBe(400);
  });

  // T-094 regression: pre-seed the caller's bucket to the limit so the next
  // request tips it over. Before the fix there was no limiter at all — every
  // request served a preview regardless of volume.
  describe('per-IP rate limit', () => {
    const LIMIT = 600;

    // Freeze the clock mid-hour so the window the test seeds and the window the
    // route computes are identical — otherwise a seed + request straddling a
    // top-of-hour boundary would land in different windows and flake. Only Date
    // is faked; real timers keep the async storage/Sharp work running.
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
        .insert({ bucket_key: `watermark:${ip}`, window_start: start.toISOString(), count });
    }

    it('serves the placeholder tile with Retry-After (never cached) once over the cap', async () => {
      const ip = crypto.randomUUID();
      await seedBucket(ip, LIMIT); // route increments to LIMIT+1 → over the cap

      const res = await makeRequest(TEST_PHOTO_PATH.split('/'), ip);

      expect(res.status).toBe(429);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(res.headers.get('cache-control') ?? '').toContain('no-store');
      // Placeholder image, not a text body, so throttled <img> tiles don't break.
      expect(res.headers.get('content-type')).toBe('image/jpeg');
    });

    it('serves normally while under the per-IP cap', async () => {
      const ip = crypto.randomUUID();
      await seedBucket(ip, LIMIT - 1); // route increments to LIMIT → still within

      const res = await makeRequest(TEST_PHOTO_PATH.split('/'), ip);
      expect(res.status).toBe(200);
    });
  });
});
