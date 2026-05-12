/**
 * Integration tests for `getPhotoDownloadUrl` in talent profile actions.
 *
 * This is a SECURITY-CRITICAL action — it returns a signed URL for the
 * full-resolution, un-watermarked photo, gated by "did this user actually
 * purchase this photo?". The earlier security audit (May 2026) explored
 * the attack path where an attacker creates fake orders/order_items via
 * PostgREST and then asks for a download URL. The H1 fix locked down the
 * RLS layer; THIS test ensures the action's own authorization check still
 * rejects unpurchased photos even if the RLS layer ever loosened again.
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

import { getPhotoDownloadUrl } from '@/app/[lang]/dashboard/talent/profile/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function seedCompletedPurchase(
  talentId: string,
  photographerId: string,
  photoId: string,
  _photoPath: string,
) {
  const sb = createServiceClient();
  const { data: order } = await sb
    .from('orders')
    .insert({ user_id: talentId, status: 'completed', total_amount_cents: 500 })
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

describe('getPhotoDownloadUrl Server Action', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(getPhotoDownloadUrl('some/path.jpg')).rejects.toThrow(/not authenticated/i);
  });

  it('rejects when the photo has not been purchased by the caller', async () => {
    // Photo exists, but no order_items link it to the talent's account.
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photoPath = `${photographer.id}/${event.id}/secret.jpg`;
    await createTestPhoto(event.id, { original_url: photoPath });
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;

    await expect(getPhotoDownloadUrl(photoPath)).rejects.toThrow(/not purchased/i);
  });

  it("rejects when another user purchased the photo (caller didn't)", async () => {
    // The order belongs to a DIFFERENT talent. The caller's auth should
    // make the join return zero rows — exact same shape as not-purchased.
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photoPath = `${photographer.id}/${event.id}/shared.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: photoPath });
    const buyer = await createTestUser('TALENT');
    const attacker = await createTestUser('TALENT');
    await seedCompletedPurchase(buyer.id, photographer.id, photo.id, photoPath);

    mockSession.userId = attacker.id;
    await expect(getPhotoDownloadUrl(photoPath)).rejects.toThrow(/not purchased/i);
  });

  it("rejects when the user's order is still pending (not completed)", async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photoPath = `${photographer.id}/${event.id}/pending.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: photoPath });
    const talent = await createTestUser('TALENT');

    // Pending order — should NOT unlock the photo. The action filters by
    // `orders.status = 'completed'`.
    const sb = createServiceClient();
    const { data: order } = await sb
      .from('orders')
      .insert({ user_id: talent.id, status: 'pending', total_amount_cents: 500 })
      .select('id')
      .single();
    await sb.from('order_items').insert({
      order_id: order!.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 500,
      total_price_cents: 500,
    });

    mockSession.userId = talent.id;
    await expect(getPhotoDownloadUrl(photoPath)).rejects.toThrow(/not purchased/i);
  });

  it('returns a signed URL when the caller purchased the photo (completed order)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photoPath = `${photographer.id}/${event.id}/legitimate.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: photoPath });
    const talent = await createTestUser('TALENT');
    await seedCompletedPurchase(talent.id, photographer.id, photo.id, photoPath);

    // Upload a placeholder byte to the storage path — createSignedUrl
    // returns null for objects that don't exist. Actual bytes don't matter;
    // we're testing that the authorization gate passes and signing succeeds.
    await ensurePhotosBucket();
    const sb = createServiceClient();
    await sb.storage.from('photos').upload(photoPath, new Uint8Array([0xff]), {
      contentType: 'image/jpeg',
      upsert: true,
    });

    mockSession.userId = talent.id;
    const url = await getPhotoDownloadUrl(photoPath);
    expect(url).toBeTruthy();
    expect(typeof url).toBe('string');
    expect(url).toMatch(/127\.0\.0\.1:54321/);
  });
});
