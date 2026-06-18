/**
 * Integration tests for `getTalentOrders` (talent orders page action).
 *
 * Security-relevant behavior: a `completed` order's photos are surfaced as
 * short-lived signed URLs to the ORIGINAL (un-watermarked) image — the buyer
 * paid for them. Any other order status stays watermarked (served via
 * `/api/watermark`). Ownership is enforced by `getUserOrders`, which scopes to
 * the authenticated caller's own orders, so another user never sees them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

vi.mock('@/app/[lang]/actions/roles', () => ({
  getActiveRole: vi.fn(async () => ({ activeRole: mockSession.activeRole })),
}));

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

import { getTalentOrders } from '@/app/[lang]/dashboard/talent/orders/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function seedOrder(
  talentId: string,
  photographerId: string,
  photoId: string,
  status: 'completed' | 'pending',
) {
  const sb = createServiceClient();
  const { data: order } = await sb
    .from('orders')
    .insert({ user_id: talentId, status, total_amount_cents: 500 })
    .select('id')
    .single();
  if (!order) throw new Error('seed order failed');
  await sb.from('order_items').insert({
    order_id: order.id,
    photo_id: photoId,
    photographer_id: photographerId,
    unit_price_cents: 500,
    total_price_cents: 500,
  });
  return order.id;
}

async function uploadPhotoBytes(path: string) {
  await ensurePhotosBucket();
  const sb = createServiceClient();
  await sb.storage.from('photos').upload(path, new Uint8Array([0xff]), {
    contentType: 'image/jpeg',
    upsert: true,
  });
}

describe('getTalentOrders Server Action', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  it('serves the original (un-watermarked) signed URL for a completed order', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photoPath = `${photographer.id}/${event.id}/bought.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: photoPath });
    await uploadPhotoBytes(photoPath);
    const talent = await createTestUser('TALENT');
    await seedOrder(talent.id, photographer.id, photo.id, 'completed');

    mockSession.userId = talent.id;
    const orders = await getTalentOrders();

    expect(orders).toHaveLength(1);
    const [thumb] = orders[0].thumbnails;
    expect(thumb).toBeTruthy();
    // Direct Supabase signed URL to the original — NOT the watermark route.
    expect(thumb).not.toContain('/api/watermark/');
    expect(thumb).toMatch(/127\.0\.0\.1:54321/);
    expect(thumb).toContain('token=');
  });

  it('keeps the watermarked preview for a non-completed (pending) order', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photoPath = `${photographer.id}/${event.id}/pending.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: photoPath });
    await uploadPhotoBytes(photoPath);
    const talent = await createTestUser('TALENT');
    await seedOrder(talent.id, photographer.id, photo.id, 'pending');

    mockSession.userId = talent.id;
    const orders = await getTalentOrders();

    expect(orders).toHaveLength(1);
    const [thumb] = orders[0].thumbnails;
    expect(thumb).toContain('/api/watermark/');
  });

  it("does not expose another user's completed-order photos to a different caller", async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photoPath = `${photographer.id}/${event.id}/private.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: photoPath });
    await uploadPhotoBytes(photoPath);
    const buyer = await createTestUser('TALENT');
    const stranger = await createTestUser('TALENT');
    await seedOrder(buyer.id, photographer.id, photo.id, 'completed');

    mockSession.userId = stranger.id;
    const orders = await getTalentOrders();

    expect(orders).toHaveLength(0);
  });
});
