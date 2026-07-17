/**
 * Integration tests for purchased-photo retention across the delete Server
 * Actions (T-142): a SOLD photo is soft-deleted (deleted_at set, row + storage
 * kept) so the buyer keeps access; an UNSOLD photo hard-deletes as before.
 *
 * `@/database/server` is mocked to a service-role client + mockSession (the
 * repo's Server Action test idiom); `supabaseAdmin` is the real local service
 * role, so the actions' admin sold-check / soft-delete run for real.
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
        if (!mockSession.userId) return { data: { user: null }, error: null } as never;
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

import { deletePhotoAction } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/actions';
import { deleteEventAction } from '@/app/[lang]/dashboard/photographer/events/actions';
import { deleteContributorPhotoAction } from '@/app/[lang]/events/[shareCode]/actions';
import { getEventPhotosPublic } from '@/database/queries/photos';
import { getTalentPurchasedPhotos } from '@/database/queries/talent-library';
import type { SupabaseServerClient } from '@/database/queries/types';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function uploadStubBytes(path: string) {
  await ensurePhotosBucket();
  await createServiceClient()
    .storage.from('photos')
    .upload(path, new Uint8Array([0xff]), { contentType: 'image/jpeg', upsert: true });
}

async function seedPurchase(buyerId: string, photographerId: string, photoId: string) {
  const sb = createServiceClient();
  const { data: order } = await sb
    .from('orders')
    .insert({ user_id: buyerId, status: 'completed', total_amount_cents: 500 })
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

async function photoRow(
  photoId: string,
): Promise<{ id: string; deleted_at: string | null } | null> {
  const { data } = await createServiceClient()
    .from('photos')
    .select('id, deleted_at')
    .eq('id', photoId)
    .maybeSingle();
  return (data as { id: string; deleted_at: string | null } | null) ?? null;
}

async function storageExists(path: string): Promise<boolean> {
  const { data, error } = await createServiceClient().storage.from('photos').download(path);
  return !error && data != null;
}

describe('deletePhotoAction — purchased-photo retention (T-142)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('soft-deletes a SOLD photo (retained: true, row + storage kept, buyer keeps access)', async () => {
    const admin = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    const photo = await createTestPhoto(event.id, { user_id: photographer.id, original_url: path });
    await uploadStubBytes(path);
    await seedPurchase(buyer.id, photographer.id, photo.id);

    mockSession.userId = photographer.id;
    const result = await deletePhotoAction(photo.id, event.id);

    expect(result).toEqual({ retained: true });
    const row = await photoRow(photo.id);
    expect(row?.deleted_at).toBeTruthy(); // retained, soft-deleted
    expect(await storageExists(path)).toBe(true); // storage kept for the buyer
    // Buyer still sees it; public gallery does not.
    expect((await getTalentPurchasedPhotos(admin, buyer.id)).map((p) => p.photo_id)).toContain(
      photo.id,
    );
    expect((await getEventPhotosPublic(admin, event.id)).map((p) => p.id)).not.toContain(photo.id);
  });

  it('hard-deletes an UNSOLD photo (retained: false, row + storage removed)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    const photo = await createTestPhoto(event.id, { user_id: photographer.id, original_url: path });
    await uploadStubBytes(path);

    mockSession.userId = photographer.id;
    const result = await deletePhotoAction(photo.id, event.id);

    expect(result).toEqual({ retained: false });
    expect(await photoRow(photo.id)).toBeNull(); // hard-deleted
    expect(await storageExists(path)).toBe(false); // storage removed
  });
});

describe('deleteContributorPhotoAction — retention (T-142)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  async function makeCollaborativeEvent(ownerId: string) {
    const event = await createTestEvent(ownerId, { is_public: false, price_per_photo: 5 });
    const sb = createServiceClient();
    await sb
      .from('events')
      .update({ is_collaborative: true, allow_guest_upload: true })
      .eq('id', event.id);
    if (!event.share_code) throw new Error('missing share code');
    return { id: event.id, shareCode: event.share_code };
  }

  it('soft-deletes a SOLD contributor photo instead of hitting the FK error', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const { id: eventId, shareCode } = await makeCollaborativeEvent(owner.id);
    const path = `${owner.id}/${eventId}/${crypto.randomUUID()}.jpg`;
    const photo = await createTestPhoto(eventId, { user_id: owner.id, original_url: path });
    await uploadStubBytes(path);
    await seedPurchase(buyer.id, owner.id, photo.id);

    mockSession.userId = owner.id;
    await expect(deleteContributorPhotoAction({ photoId: photo.id, shareCode })).resolves.toEqual({
      success: true,
    });

    const row = await photoRow(photo.id);
    expect(row?.deleted_at).toBeTruthy();
    expect(await storageExists(path)).toBe(true);
  });

  it('hard-deletes an UNSOLD contributor photo', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const { id: eventId, shareCode } = await makeCollaborativeEvent(owner.id);
    const photo = await createTestPhoto(eventId, { user_id: owner.id });

    mockSession.userId = owner.id;
    await deleteContributorPhotoAction({ photoId: photo.id, shareCode });

    expect(await photoRow(photo.id)).toBeNull();
  });
});

describe('deleteEventAction — retention (T-142)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('retains sold photos (soft-deleted) while hard-deleting unsold ones; buyer keeps access', async () => {
    const admin = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const soldPath = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    const sold = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: soldPath,
    });
    const unsold = await createTestPhoto(event.id, { user_id: photographer.id });
    await uploadStubBytes(soldPath);
    await seedPurchase(buyer.id, photographer.id, sold.id);

    mockSession.userId = photographer.id;
    await deleteEventAction(event.id);

    // Sold photo retained + soft-deleted; its storage kept.
    const soldRow = await photoRow(sold.id);
    expect(soldRow?.deleted_at).toBeTruthy();
    expect(await storageExists(soldPath)).toBe(true);
    // Unsold photo hard-deleted.
    expect(await photoRow(unsold.id)).toBeNull();
    // Event soft-deleted.
    const { data: eventRow } = await createServiceClient()
      .from('events')
      .select('deleted_at')
      .eq('id', event.id)
      .single();
    expect(eventRow?.deleted_at).toBeTruthy();
    // Buyer still sees the purchased photo after the whole event was deleted.
    expect((await getTalentPurchasedPhotos(admin, buyer.id)).map((p) => p.photo_id)).toContain(
      sold.id,
    );
  });
});
