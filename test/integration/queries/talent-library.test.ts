/**
 * Integration tests for the talent-library "owned photos" queries — the
 * claimed-free-photos collection and its union with purchased photos.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimPhotoForTalent,
  getClaimedPhotoIdsForTalent,
  getTalentOwnedPhotos,
} from '@/database/queries/talent-library';
import type { SupabaseServerClient } from '@/database/queries/types';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** Seed a completed purchase of `photoId` by `buyerId`. */
async function seedPurchase(
  buyerId: string,
  photographerId: string,
  photoId: string,
): Promise<void> {
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

describe('talent-library — claimed photos', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('claims a photo and is idempotent on a duplicate claim', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');

    await claimPhotoForTalent(sb, photo.id, talent.id);
    // A repeat claim must not throw (unique-violation swallowed).
    await expect(claimPhotoForTalent(sb, photo.id, talent.id)).resolves.toBeUndefined();

    const ids = await getClaimedPhotoIdsForTalent(sb, talent.id);
    expect([...ids]).toEqual([photo.id]);
  });

  it('scopes claimed ids to the talent', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const p1 = await createTestPhoto(event.id);
    const p2 = await createTestPhoto(event.id);
    const talentA = await createTestUser('TALENT');
    const talentB = await createTestUser('TALENT');
    await claimPhotoForTalent(sb, p1.id, talentA.id);
    await claimPhotoForTalent(sb, p2.id, talentB.id);

    expect([...(await getClaimedPhotoIdsForTalent(sb, talentA.id))]).toEqual([p1.id]);
  });

  it('getClaimedPhotoIdsForTalent returns empty for an empty candidate list', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');
    await claimPhotoForTalent(sb, photo.id, talent.id);

    expect((await getClaimedPhotoIdsForTalent(sb, talent.id, [])).size).toBe(0);
  });
});

describe('talent-library — getTalentOwnedPhotos', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns purchased ∪ claimed photos with the right discriminator', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const photographer = await createTestUser('PHOTOGRAPHER');
    const talent = await createTestUser('TALENT');

    // A purchased photo (paid event).
    const paidEvent = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const purchased = await createTestPhoto(paidEvent.id);
    await seedPurchase(talent.id, photographer.id, purchased.id);

    // A claimed photo (free event).
    const freeEvent = await createTestEvent(photographer.id, { price_per_photo: null });
    const claimed = await createTestPhoto(freeEvent.id);
    await claimPhotoForTalent(sb, claimed.id, talent.id);

    const owned = await getTalentOwnedPhotos(sb, talent.id);
    expect(owned.map((p) => p.photo_id).sort()).toEqual([purchased.id, claimed.id].sort());

    const claimedRow = owned.find((p) => p.photo_id === claimed.id);
    expect(claimedRow?.acquired_via).toBe('claim');
    expect(claimedRow?.order_id).toBeNull();

    const purchasedRow = owned.find((p) => p.photo_id === purchased.id);
    expect(purchasedRow?.acquired_via).toBe('purchase');
    expect(purchasedRow?.order_id).not.toBeNull();
  });

  it('returns an empty array for a talent who owns nothing', async () => {
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    const talent = await createTestUser('TALENT');
    expect(await getTalentOwnedPhotos(sb, talent.id)).toEqual([]);
  });
});
