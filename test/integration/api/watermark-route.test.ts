/**
 * Integration tests for `app/api/watermark/[...path]/route.ts`.
 *
 * Strategy: call the GET handler directly (no HTTP server needed), against
 * local Supabase storage (Docker) with a real JPEG fixture. Verifies:
 *   - Valid stored original → 200 watermarked JPEG with the 24h cache header
 *   - Missing object → 404 placeholder (fail-closed), never cached
 *   - Path traversal → 400
 *   - T-094: over the per-IP hourly cap → 429 with Retry-After, never cached
 *   - T-133: treatment picked server-side from the event's watermark policy —
 *     no-watermark events get a clean medium-budget (800px) downscale, while
 *     watermarked or UNKNOWN-policy paths keep the tiled pipeline (1024px)
 */

import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/watermark/[...path]/route';
import { computeWindow } from '@/lib/rate-limit';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
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

  // T-133: the treatment is decided server-side from the photo's event. A
  // 1600×1200 source makes the branch observable in the output size — the
  // watermark pipeline resizes to 1024 longest-side, the clean no-watermark
  // downscale to the public medium-thumb budget (800). Neither ever returns
  // the 1600px original.
  describe('server-side treatment by event watermark policy (T-133)', () => {
    let largeJpeg: Buffer;
    const uploadedPaths: string[] = [];

    beforeAll(async () => {
      largeJpeg = await sharp({
        create: { width: 1600, height: 1200, channels: 3, background: { r: 40, g: 90, b: 60 } },
      })
        .jpeg({ quality: 80 })
        .toBuffer();
    });

    afterAll(async () => {
      // resetDatabase truncates tables, not storage — clean our objects so
      // the local bucket doesn't accumulate 1600×1200 blobs across runs.
      if (uploadedPaths.length > 0) {
        await createServiceClient().storage.from(BUCKET).remove(uploadedPaths);
      }
    });

    async function uploadLargeJpeg(storagePath: string) {
      await createServiceClient()
        .storage.from(BUCKET)
        .upload(storagePath, largeJpeg, { contentType: 'image/jpeg', upsert: true });
      uploadedPaths.push(storagePath);
    }

    /** Seed an event + photo row + stored object; returns the storage path. */
    async function seedEventPhoto(opts: { watermarkEnabled: boolean }): Promise<string> {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
      await createServiceClient()
        .from('events')
        .update({ watermark_enabled: opts.watermarkEnabled })
        .eq('id', event.id);
      const storagePath = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
      await uploadLargeJpeg(storagePath);
      await createTestPhoto(event.id, { user_id: photographer.id, original_url: storagePath });
      return storagePath;
    }

    it('serves the clean baked-thumbnail treatment for a sellable NO-watermark event — never the full-res original', async () => {
      const storagePath = await seedEventPhoto({ watermarkEnabled: false });

      const res = await makeRequest(storagePath.split('/'));

      expect(res.status).toBe(200);
      // Literally the bake job's generateThumbnail('medium') output: webp,
      // medium budget (800) — NOT the watermark pipeline's 1024, and NEVER
      // the 1600 source.
      expect(res.headers.get('content-type')).toBe('image/webp');
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(800);
      expect(meta.height).toBe(600);
      // Shorter TTL than the watermark branch: a watermark_enabled flip must
      // stop serving clean cached copies within the hour.
      expect(res.headers.get('cache-control') ?? '').toContain('max-age=3600');
    });

    it('keeps the tiled watermark pipeline (cached 24h) for a watermarked event', async () => {
      const storagePath = await seedEventPhoto({ watermarkEnabled: true });

      const res = await makeRequest(storagePath.split('/'));

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect(res.headers.get('cache-control') ?? '').toContain('max-age=86400');
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      // The watermark pipeline's 1024 longest-side — proves the clean branch
      // did NOT run for a watermarked event.
      expect(meta.width).toBe(1024);
      expect(meta.height).toBe(768);
    });

    it('fails closed to the watermark pipeline when the policy is unknown (no photo row for the path)', async () => {
      const orphanPath = `orphan-user/orphan-event/${crypto.randomUUID()}.jpg`;
      await uploadLargeJpeg(orphanPath);

      const res = await makeRequest(orphanPath.split('/'));

      expect(res.status).toBe(200);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      // Unknown policy must NOT get the clean treatment — an attacker must
      // never obtain a cleaner copy by pointing the route at a path the DB
      // can't vouch for.
      expect(meta.width).toBe(1024);
    });

    it('ignores a planted photos row not bound to the path event — a crafted row cannot unlock the clean treatment', async () => {
      // Photos RLS only checks user_id on insert, so any authenticated user
      // can plant a row whose original_url points at someone else's storage
      // object while event_id points at their OWN no-watermark event. During
      // the victim's orphan-cleanup window (photo row gone, object still in
      // storage) that planted row would be the only original_url match — an
      // unbound-row lookup would read the attacker's watermark_enabled=false
      // and serve a clean copy of the victim's payment-gated photo.
      const victim = await createTestUser('PHOTOGRAPHER');
      const victimEvent = await createTestEvent(victim.id, { price_per_photo: 10 });
      // watermark_enabled stays at the DB default (true) — a watermarked event.
      const victimPath = `${victim.id}/${victimEvent.id}/${crypto.randomUUID()}.jpg`;
      await uploadLargeJpeg(victimPath);
      // No photo row for victimPath — simulates the orphan-cleanup window.

      const attacker = await createTestUser('PHOTOGRAPHER');
      const attackerEvent = await createTestEvent(attacker.id, { price_per_photo: 10 });
      await createServiceClient()
        .from('events')
        .update({ watermark_enabled: false })
        .eq('id', attackerEvent.id);
      // The planted row: attacker's no-watermark event claiming the victim's path.
      await createTestPhoto(attackerEvent.id, { user_id: attacker.id, original_url: victimPath });

      const res = await makeRequest(victimPath.split('/'));

      expect(res.status).toBe(200);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      // The planted row's event_id doesn't match the path's event segment →
      // ignored → policy unknown → tiled watermark (1024), never the clean 800.
      expect(meta.width).toBe(1024);
      expect(meta.format).not.toBe('webp');
    });
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
