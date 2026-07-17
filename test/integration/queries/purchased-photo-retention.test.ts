/**
 * Integration tests for purchased-photo retention (T-142) at the query layer.
 *
 * A photo that has been SOLD is soft-deleted (deleted_at set, row + storage
 * kept) instead of hard-deleted. The invariants:
 *   - photographer/public/search/cart reads EXCLUDE soft-deleted photos.
 *   - buyer-facing reads (purchased library, download authorization) INCLUDE
 *     them so the buyer keeps access.
 *   - the orphaned-storage-cleanup in-use lookup still counts a soft-deleted
 *     photo's storage path (so it is never swept).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getEventPhotosPublic,
  getEventPhotosPublicPage,
  getPhotoForDownload,
  getPurchasablePhotoIds,
  getSoldPhotoIds,
  softDeletePhotosByIds,
} from '@/database/queries/photos';
import { getTalentPurchasedPhotos } from '@/database/queries/talent-library';
import type { SupabaseServerClient } from '@/database/queries/types';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** Seed a completed purchase of `photoId` by `buyerId`. */
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

describe('purchased-photo retention (T-142) — query layer', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('getSoldPhotoIds returns only the sold subset', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const sold = await createTestPhoto(event.id, { user_id: photographer.id });
    const unsold = await createTestPhoto(event.id, { user_id: photographer.id });
    await seedPurchase(buyer.id, photographer.id, sold.id);

    const result = await getSoldPhotoIds(sb, [sold.id, unsold.id]);
    expect([...result]).toEqual([sold.id]);
  });

  it('soft-delete hides the photo from public/purchasable reads but keeps it for the buyer', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    await seedPurchase(buyer.id, photographer.id, photo.id);

    // Before soft-delete: visible publicly, purchasable, and in the buyer library.
    expect((await getEventPhotosPublic(sb, event.id)).map((p) => p.id)).toContain(photo.id);
    expect((await getPurchasablePhotoIds(sb, [photo.id])).has(photo.id)).toBe(true);

    await softDeletePhotosByIds(sb, [photo.id]);

    // After soft-delete: gone from every non-buyer surface…
    expect((await getEventPhotosPublic(sb, event.id)).map((p) => p.id)).not.toContain(photo.id);
    const page = await getEventPhotosPublicPage(sb, event.id, { limit: 50, offset: 0 });
    expect(page.photos.map((p) => p.id)).not.toContain(photo.id);
    expect((await getPurchasablePhotoIds(sb, [photo.id])).has(photo.id)).toBe(false);

    // …but STILL in the buyer's purchased library (access preserved).
    const owned = await getTalentPurchasedPhotos(sb, buyer.id);
    expect(owned.map((p) => p.photo_id)).toContain(photo.id);

    // …and still resolvable for single-photo download authorization.
    const downloadable = await getPhotoForDownload(sb, photo.id, event.id);
    expect(downloadable?.id).toBe(photo.id);
  });

  it('orphaned-storage-cleanup in-use lookup still counts a soft-deleted photo (never swept)', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const buyer = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const path = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    const photo = await createTestPhoto(event.id, { user_id: photographer.id, original_url: path });
    await seedPurchase(buyer.id, photographer.id, photo.id);
    await softDeletePhotosByIds(sb as unknown as SupabaseServerClient, [photo.id]);

    // Mirror the cleanup cron's in-use query (no deleted_at filter — see
    // cleanup-orphaned-storage.ts). The retained path MUST still be reported.
    const { data } = await sb.from('photos').select('original_url').in('original_url', [path]);
    expect((data ?? []).map((r) => r.original_url)).toContain(path);
  });
});
