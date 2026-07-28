/**
 * Integration tests for the minimum-photo-price floor (billing v2, T-195).
 *
 * The floor is enforced at WRITE time in both event Server Actions, not as a DB
 * constraint — so an event priced below a later-raised floor keeps working
 * until someone next writes its price. These pin that behaviour end to end
 * against the real schema.
 *
 * The floor is env-configured and `env.mjs` parses at import time, so the value
 * is set in a `vi.hoisted` block: it runs before the module imports below.
 * (Default in every other test file is 0 = disabled, which is also production's
 * dark-launch default.)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

vi.hoisted(() => {
  process.env.MIN_PHOTO_PRICE_CENTS = '150';
});

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

import { updateEventAction } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/actions';
import { createEvent } from '@/app/[lang]/dashboard/photographer/events/new/actions';
import { getMinPhotoPriceCents } from '@/lib/plans';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

function buildEventFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    name: 'Priced Event',
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
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) fd.append(k, v);
  return fd;
}

let userId: string;

beforeEach(async () => {
  await resetDatabase();
  await ensurePhotosBucket();
  const user = await createTestUser('PHOTOGRAPHER');
  userId = user.id;
  mockSession.userId = user.id;
  mockSession.activeRole = 'photographer';
});

describe('minimum photo price — configuration', () => {
  it('reads the configured floor (€1.50)', () => {
    expect(getMinPhotoPriceCents()).toBe(150);
  });
});

describe('createEvent price floor', () => {
  it('rejects a priced event below the floor', async () => {
    await expect(createEvent(buildEventFormData({ price_per_photo: '0.50' }))).rejects.toThrow(
      /MIN_PHOTO_PRICE:150/,
    );

    const sb = createServiceClient();
    const { data } = await sb.from('events').select('id').eq('user_id', userId);
    expect(data ?? []).toHaveLength(0);
  });

  it('rejects a price one cent under the floor', async () => {
    await expect(createEvent(buildEventFormData({ price_per_photo: '1.49' }))).rejects.toThrow(
      /MIN_PHOTO_PRICE:150/,
    );
  });

  it('accepts a price exactly at the floor', async () => {
    const result = await createEvent(buildEventFormData({ price_per_photo: '1.50' }));
    expect(result.eventId).toBeTruthy();

    const sb = createServiceClient();
    const { data } = await sb
      .from('events')
      .select('price_per_photo')
      .eq('id', result.eventId)
      .single();
    expect(Number(data?.price_per_photo)).toBe(1.5);
  });

  it('accepts a price above the floor', async () => {
    const result = await createEvent(buildEventFormData({ price_per_photo: '12.50' }));
    expect(result.eventId).toBeTruthy();
  });

  it('exempts a free event (no price)', async () => {
    const result = await createEvent(buildEventFormData({ price_per_photo: '' }));
    expect(result.eventId).toBeTruthy();

    const sb = createServiceClient();
    const { data } = await sb
      .from('events')
      .select('price_per_photo')
      .eq('id', result.eventId)
      .single();
    expect(data?.price_per_photo).toBeNull();
  });

  it('exempts an explicitly zero-priced event', async () => {
    const result = await createEvent(buildEventFormData({ price_per_photo: '0' }));
    expect(result.eventId).toBeTruthy();
  });
});

describe('updateEventAction price floor', () => {
  it('rejects lowering a price below the floor', async () => {
    const event = await createTestEvent(userId, { price_per_photo: 5 });

    await expect(
      updateEventAction(event.id, buildEventFormData({ price_per_photo: '0.99' })),
    ).rejects.toThrow(/MIN_PHOTO_PRICE:150/);

    const sb = createServiceClient();
    const { data } = await sb.from('events').select('price_per_photo').eq('id', event.id).single();
    // The rejected write left the stored price untouched.
    expect(Number(data?.price_per_photo)).toBe(5);
  });

  it('accepts a price at or above the floor', async () => {
    const event = await createTestEvent(userId, { price_per_photo: 5 });

    const result = await updateEventAction(
      event.id,
      buildEventFormData({ price_per_photo: '1.50' }),
    );
    expect(result?.success).toBe(true);

    const sb = createServiceClient();
    const { data } = await sb.from('events').select('price_per_photo').eq('id', event.id).single();
    expect(Number(data?.price_per_photo)).toBe(1.5);
  });

  it('lets a priced event be turned free', async () => {
    const event = await createTestEvent(userId, { price_per_photo: 5 });

    const result = await updateEventAction(event.id, buildEventFormData({ price_per_photo: '' }));
    expect(result?.success).toBe(true);
  });

  it('leaves an existing sub-floor event alone until its price is written', async () => {
    // The floor is a write-time rule, not a DB constraint: a row created before
    // the floor existed (or before it was raised) stays readable and sellable.
    const event = await createTestEvent(userId, { price_per_photo: 0.5 });

    const sb = createServiceClient();
    const { data } = await sb.from('events').select('price_per_photo').eq('id', event.id).single();
    expect(Number(data?.price_per_photo)).toBe(0.5);
  });
});
