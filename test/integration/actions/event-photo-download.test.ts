/**
 * Integration tests for `getEventPhotoDownloadUrlAction` — the public
 * event-page single-photo download.
 *
 * SECURITY-CRITICAL: the action returns a signed URL for the original,
 * un-watermarked file. Free events are open to anyone with the link (incl.
 * logged-out guests); paid events must be gated to the event owner or a
 * viewer who purchased that photo. The permission check lives in the action
 * itself, so this test guards it independently of the RLS layer.
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

import { getEventPhotoDownloadUrlAction } from '@/app/[lang]/events/[shareCode]/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** Upload a placeholder byte — `createSignedUrl` returns null for a missing object. */
async function uploadPlaceholder(path: string): Promise<void> {
  await ensurePhotosBucket();
  const sb = createServiceClient();
  await sb.storage.from('photos').upload(path, new Uint8Array([0xff]), {
    contentType: 'image/jpeg',
    upsert: true,
  });
}

async function seedPurchase(
  buyerId: string,
  photographerId: string,
  photoId: string,
  status: 'completed' | 'pending',
): Promise<void> {
  const sb = createServiceClient();
  const { data: order } = await sb
    .from('orders')
    .insert({ user_id: buyerId, status, total_amount_cents: 500 })
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
}

describe('getEventPhotoDownloadUrlAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
  });

  it('returns a signed URL for a logged-out guest on a free event', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const path = `${photographer.id}/${event.id}/free.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: path });
    await uploadPlaceholder(path);

    mockSession.userId = null;
    const url = await getEventPhotoDownloadUrlAction(photo.id, event.id);
    expect(url).toMatch(/127\.0\.0\.1:54321/);
  });

  it('returns a signed URL for the event owner on a paid event', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/owner.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: path });
    await uploadPlaceholder(path);

    mockSession.userId = photographer.id;
    const url = await getEventPhotoDownloadUrlAction(photo.id, event.id);
    expect(url).toMatch(/127\.0\.0\.1:54321/);
  });

  it('returns a signed URL for the purchaser on a paid event', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/bought.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: path });
    await uploadPlaceholder(path);
    const buyer = await createTestUser('TALENT');
    await seedPurchase(buyer.id, photographer.id, photo.id, 'completed');

    mockSession.userId = buyer.id;
    const url = await getEventPhotoDownloadUrlAction(photo.id, event.id);
    expect(url).toMatch(/127\.0\.0\.1:54321/);
  });

  it('rejects an authenticated non-purchaser on a paid event', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/paid.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: path });
    const stranger = await createTestUser('TALENT');

    mockSession.userId = stranger.id;
    await expect(getEventPhotoDownloadUrlAction(photo.id, event.id)).rejects.toThrow(/permission/i);
  });

  it('rejects a logged-out guest on a paid event', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/paid-guest.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: path });

    mockSession.userId = null;
    await expect(getEventPhotoDownloadUrlAction(photo.id, event.id)).rejects.toThrow(/permission/i);
  });

  it('rejects when the buyer only has a pending (not completed) order', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/pending.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: path });
    const buyer = await createTestUser('TALENT');
    await seedPurchase(buyer.id, photographer.id, photo.id, 'pending');

    mockSession.userId = buyer.id;
    await expect(getEventPhotoDownloadUrlAction(photo.id, event.id)).rejects.toThrow(/permission/i);
  });

  it('does NOT serve a soft-deleted (sold) photo via the free-event branch (T-142 leak)', async () => {
    // Paid event → photo sold → soft-deleted → event switched to free. The
    // free/owner all-access branch must not expose the retained original.
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/retained.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: path });
    await uploadPlaceholder(path);
    const buyer = await createTestUser('TALENT');
    await seedPurchase(buyer.id, photographer.id, photo.id, 'completed');
    const sb = createServiceClient();
    await sb.from('photos').update({ deleted_at: new Date().toISOString() }).eq('id', photo.id);
    await sb.from('events').update({ price_per_photo: null }).eq('id', event.id);

    // A logged-out guest on the now-free event must be denied the retained photo.
    mockSession.userId = null;
    await expect(getEventPhotoDownloadUrlAction(photo.id, event.id)).rejects.toThrow(/permission/i);
  });

  it('still lets the buyer download their own soft-deleted (sold) photo (T-142)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/retained-buyer.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: path });
    await uploadPlaceholder(path);
    const buyer = await createTestUser('TALENT');
    await seedPurchase(buyer.id, photographer.id, photo.id, 'completed');
    await createServiceClient()
      .from('photos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', photo.id);

    // The buyer keeps access via the purchased-set branch even after soft-delete.
    mockSession.userId = buyer.id;
    const url = await getEventPhotoDownloadUrlAction(photo.id, event.id);
    expect(url).toMatch(/127\.0\.0\.1:54321/);
  });

  it("rejects when the photo doesn't belong to the given event", async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const eventA = await createTestEvent(photographer.id, { price_per_photo: null });
    const eventB = await createTestEvent(photographer.id, { price_per_photo: null });
    const photo = await createTestPhoto(eventA.id);

    mockSession.userId = null;
    await expect(getEventPhotoDownloadUrlAction(photo.id, eventB.id)).rejects.toThrow(/not found/i);
  });
});
