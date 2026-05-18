/**
 * Integration tests for plan-tier limit enforcement.
 *
 * Covers:
 *   - `assertCanCreateEvent` — Free user blocked at 3 events; Pro user passes; soft-deleted events don't count.
 *   - `assertCanUploadPhoto` — blocked when adding the file would overflow the cap; respects `currentUsageBytes` override; Pro user (unlimited) always passes.
 *   - `getUsageStats` — aggregate counts match raw DB state.
 *   - `createEvent` (real Server Action) — throws PlanLimitError when at the event cap.
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

import sharp from 'sharp';
import { createEvent } from '@/app/[lang]/dashboard/photographer/events/new/actions';
import {
  assertCanCreateEvent,
  assertCanUploadPhoto,
  getUsageStats,
  isPlanLimitError,
  type PlanLimitError,
} from '@/lib/plan-limits';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const ONE_GB = 1024 ** 3;
const FREE_MAX_EVENTS = 5;
const FREE_STORAGE_GB = 20;
const FREE_STORAGE_BYTES = FREE_STORAGE_GB * ONE_GB;

async function seedSubscription(
  userId: string,
  planId: 'free' | 'starter' | 'pro',
  status = 'active',
) {
  const sb = createServiceClient();
  const { error } = await sb.from('subscriptions').insert({
    user_id: userId,
    stripe_customer_id: `cus_${userId.slice(0, 8)}`,
    stripe_subscription_id: null,
    plan_id: planId,
    status,
  });
  if (error) throw new Error(`seedSubscription: ${error.message}`);
}

async function makeJpegFile(name = 'photo.jpg'): Promise<File> {
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#112233' },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(buf)], name, { type: 'image/jpeg' });
}

function buildEventFormData(overrides: Record<string, string> = {}, photos: File[] = []): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    name: 'Test Event',
    activity: 'SURF',
    date: '2026-06-15',
    country: 'ES',
    state: 'Catalonia',
    city: 'Barcelona',
    event_type: 'solo',
    is_public: 'true',
    watermark_enabled: 'true',
    is_collaborative: 'false',
    allow_guest_upload: 'true',
    require_upload_approval: 'false',
    price_per_photo: '',
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.append(k, v);
  }
  for (const file of photos) fd.append('photos', file);
  return fd;
}

describe('assertCanCreateEvent', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('passes when the user is below the Free cap', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    await createTestEvent(user.id);
    await createTestEvent(user.id);
    // 2 events, Free cap is 3 → passes.
    await expect(assertCanCreateEvent(createServiceClient(), user.id)).resolves.toBeUndefined();
  });

  it('throws PlanLimitError when the Free user is already at the cap', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    for (let i = 0; i < FREE_MAX_EVENTS; i += 1) {
      await createTestEvent(user.id);
    }
    await expect(assertCanCreateEvent(createServiceClient(), user.id)).rejects.toSatisfy(
      (err: unknown) => isPlanLimitError(err) && (err as PlanLimitError).limitType === 'maxEvents',
    );
  });

  it('does NOT count soft-deleted events toward the cap', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    const sb = createServiceClient();
    for (let i = 0; i < FREE_MAX_EVENTS; i += 1) {
      await createTestEvent(user.id);
    }
    // Soft-delete one — should free up a slot.
    const { data: events } = await sb.from('events').select('id').eq('user_id', user.id).limit(1);
    if (!events?.[0]) throw new Error('expected at least one event');
    await sb.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', events[0].id);

    await expect(assertCanCreateEvent(sb, user.id)).resolves.toBeUndefined();
  });

  it('passes unconditionally for Pro users (unlimited maxEvents)', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    await seedSubscription(user.id, 'pro');
    // Seed many events — Pro has no cap.
    for (let i = 0; i < FREE_MAX_EVENTS + 2; i += 1) {
      await createTestEvent(user.id);
    }
    await expect(assertCanCreateEvent(createServiceClient(), user.id)).resolves.toBeUndefined();
  });
});

describe('assertCanUploadPhoto', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('passes when adding the file stays under the cap', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    // Free cap is 20 GB. 100 MB usage + 1 MB file = well under.
    const currentUsage = 100 * 1024 * 1024;
    await expect(
      assertCanUploadPhoto(createServiceClient(), user.id, 1024 * 1024, currentUsage),
    ).resolves.toBeUndefined();
  });

  it('throws PlanLimitError when adding the file would overflow the cap', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    const currentUsage = FREE_STORAGE_BYTES - 1024; // 1 KB short of cap
    const fileSize = 2048; // 2 KB → would overflow
    await expect(
      assertCanUploadPhoto(createServiceClient(), user.id, fileSize, currentUsage),
    ).rejects.toSatisfy(
      (err: unknown) => isPlanLimitError(err) && (err as PlanLimitError).limitType === 'storage',
    );
  });

  it('reads usage from the DB when currentUsageBytes is omitted', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(user.id);
    // Seed a photo at the cap so any further upload should fail.
    const sb = createServiceClient();
    await sb.from('photos').insert({
      user_id: user.id,
      event_id: event.id,
      original_url: `${user.id}/${event.id}/seed.jpg`,
      taken_at: new Date().toISOString(),
      city: 'Barcelona',
      country: 'ES',
      size_bytes: FREE_STORAGE_BYTES,
    });
    // No explicit currentUsage — the helper must query the DB.
    await expect(assertCanUploadPhoto(sb, user.id, 1024)).rejects.toSatisfy((err: unknown) =>
      isPlanLimitError(err),
    );
  });

  it('respects the higher Pro storage cap (250 GB) — usage that would exceed Free passes', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    await seedSubscription(user.id, 'pro');
    // 30 GB usage + 1 MB file: would overflow the Free 20 GB cap, but well
    // under the Pro 250 GB cap.
    await expect(
      assertCanUploadPhoto(createServiceClient(), user.id, 1024 * 1024, 30 * ONE_GB),
    ).resolves.toBeUndefined();
  });
});

describe('getUsageStats', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns counts that match the DB state', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    const e1 = await createTestEvent(user.id);
    await createTestEvent(user.id);
    const sb = createServiceClient();
    await sb.from('photos').insert({
      user_id: user.id,
      event_id: e1.id,
      original_url: `${user.id}/${e1.id}/p.jpg`,
      taken_at: new Date().toISOString(),
      city: 'Barcelona',
      country: 'ES',
      size_bytes: 12345,
    });

    const stats = await getUsageStats(sb, user.id);
    expect(stats.eventsCount).toBe(2);
    expect(stats.eventsLimit).toBe(FREE_MAX_EVENTS);
    expect(stats.storageUsedBytes).toBe(12345);
    expect(stats.storageLimitBytes).toBe(FREE_STORAGE_BYTES);
    expect(stats.planId).toBe('free');
  });

  it('reports null limits for Pro users', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    await seedSubscription(user.id, 'pro');
    const stats = await getUsageStats(createServiceClient(), user.id);
    expect(stats.eventsLimit).toBeNull();
    expect(stats.storageLimitBytes).not.toBeNull(); // Pro is 250 GB, not unlimited.
  });
});

describe('createEvent — maxEvents enforcement', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('throws PlanLimitError when a Free user is already at the event cap', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    for (let i = 0; i < FREE_MAX_EVENTS; i += 1) {
      await createTestEvent(user.id);
    }
    mockSession.userId = user.id;

    const fd = buildEventFormData({}, [await makeJpegFile()]);
    await expect(createEvent(fd)).rejects.toSatisfy(
      (err: unknown) => isPlanLimitError(err) && (err as PlanLimitError).limitType === 'maxEvents',
    );
  });

  it('returns { uploaded, skipped: [] } on a successful create within the cap', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;

    const result = await createEvent(buildEventFormData({}, [await makeJpegFile()]));
    expect(result.uploaded).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(result.eventId).toBeTruthy();
  });
});
