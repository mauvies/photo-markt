/**
 * Regression tests: buyers must be able to SEE and DOWNLOAD their purchased
 * photos (talent orders page + profile library + single-photo download).
 *
 * Root cause: the buyer does NOT own the photographer's `photos`/`events` rows
 * (owner-only `own_photos_select` / `own_rows_select` RLS) nor the `photos`
 * storage objects (no user SELECT policy). The orders/profile/download actions
 * used to read + sign with the USER-SCOPED client, so `photos!inner` joins
 * dropped every purchased row (empty profile library), the orders left-embed
 * returned a null photo (every purchase showed the T-116 "no longer available"
 * fallback), and signing returned null. The fix reads + signs via
 * `supabaseAdmin` while keeping the in-query `user_id` filters that enforce
 * ownership — the same pattern T-130 applied to the cart.
 *
 * UNLIKE `talent-orders.test.ts` / `talent-profile-download.test.ts`, which mock
 * `@/database/server` to return a SERVICE-ROLE client (bypassing RLS, so they
 * never reproduce this bug), this suite mocks it to return a REAL user-scoped
 * client (`signInAs`) — the only way the RLS denials the bug depends on can
 * reproduce. `supabaseAdmin` is left un-mocked (real local service role), so the
 * action's admin reads exercise the actual fix.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/database/server', () => ({
  createClient: vi.fn(async () => {
    if (!holder.client) throw new Error('test: assign holder.client before calling the action');
    return holder.client;
  }),
  getUser: vi.fn(async () => {
    const client = holder.client as SupabaseClient | null;
    if (!client) return null;
    const { data } = await client.auth.getUser();
    return data.user;
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3000' })),
}));

import { getTalentOrders } from '@/app/[lang]/dashboard/talent/orders/actions';
import { getPhotoDownloadUrl, getProfileData } from '@/app/[lang]/dashboard/talent/profile/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

/** Upload a stub byte at `path` so `createSignedUrl` has a real object to sign. */
async function uploadStubBytes(path: string) {
  await ensurePhotosBucket();
  await createServiceClient()
    .storage.from('photos')
    .upload(path, new Uint8Array([0xff]), { contentType: 'image/jpeg', upsert: true });
}

/** Seed a completed purchase of `photoId` by `buyerId`. */
async function seedCompletedOrder(buyerId: string, photographerId: string, photoId: string) {
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
  return order.id;
}

/** A photographer-owned purchasable photo with real bytes in storage. */
async function seedForeignPhoto() {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
  const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
  await uploadStubBytes(originalUrl);
  const photo = await createTestPhoto(event.id, {
    user_id: photographer.id,
    original_url: originalUrl,
  });
  return { photographer, event, photo, originalUrl };
}

/** A photographer-owned photo on a FREE event, claimed into the talent's library. */
async function seedClaimedPhoto(talentId: string) {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(photographer.id, { price_per_photo: null });
  const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
  await uploadStubBytes(originalUrl);
  const photo = await createTestPhoto(event.id, {
    user_id: photographer.id,
    original_url: originalUrl,
  });
  await createServiceClient()
    .from('talent_claimed_photos')
    .insert({ photo_id: photo.id, talent_user_id: talentId });
  return { photo, originalUrl };
}

describe('purchased photos are visible to the buyer', () => {
  beforeEach(async () => {
    await resetDatabase();
    holder.client = null;
  });

  describe('orders page (getTalentOrders)', () => {
    it("returns a real thumbnail for a completed order of a photo the buyer doesn't own", async () => {
      const { photographer, photo } = await seedForeignPhoto();
      const buyer = await createTestUser('TALENT');
      await seedCompletedOrder(buyer.id, photographer.id, photo.id);
      holder.client = await signInAs(buyer.email);

      const orders = await getTalentOrders();

      // Before the fix: the user-scoped `photos(original_url)` embed returned
      // null and signing was RLS-denied, so this thumbnail was null and the UI
      // showed the "photo no longer available" fallback for a live purchase.
      expect(orders).toHaveLength(1);
      const [thumb] = orders[0].thumbnails;
      expect(thumb).toBeTruthy();
      // Completed order → clean signed original (not the watermark route).
      expect(thumb).not.toContain('/api/watermark/');
      expect(thumb).toContain('token=');
    });

    it("does not expose another buyer's completed-order photos", async () => {
      const { photographer, photo } = await seedForeignPhoto();
      const buyer = await createTestUser('TALENT');
      const stranger = await createTestUser('TALENT');
      await seedCompletedOrder(buyer.id, photographer.id, photo.id);
      holder.client = await signInAs(stranger.email);

      // `getUserOrders` scopes to the caller's own orders, so the admin item
      // read only ever sees this stranger's (empty) order set.
      expect(await getTalentOrders()).toHaveLength(0);
    });
  });

  describe('profile library (getProfileData)', () => {
    it('shows purchased ∪ claimed photos with resolvable previews', async () => {
      const buyer = await createTestUser('TALENT');
      const { photographer, photo: purchased } = await seedForeignPhoto();
      await seedCompletedOrder(buyer.id, photographer.id, purchased.id);
      const { photo: claimed } = await seedClaimedPhoto(buyer.id);
      holder.client = await signInAs(buyer.email);

      const { photos, stats } = await getProfileData();

      // Before the fix: `photos!inner` dropped every owned row under the buyer's
      // RLS view and the grid rendered empty.
      expect(photos.map((p) => p.photo_id).sort()).toEqual([purchased.id, claimed.id].sort());
      for (const p of photos) {
        expect(p.preview_url).toBeTruthy();
      }
      expect(stats.eventsCount).toBeGreaterThanOrEqual(1);
    });

    it('returns an empty library for a buyer who owns nothing', async () => {
      const { photographer, photo } = await seedForeignPhoto();
      const buyer = await createTestUser('TALENT');
      const stranger = await createTestUser('TALENT');
      await seedCompletedOrder(buyer.id, photographer.id, photo.id);
      holder.client = await signInAs(stranger.email);

      const { photos } = await getProfileData();
      expect(photos).toEqual([]);
    });
  });

  describe('single-photo download (getPhotoDownloadUrl)', () => {
    it('returns a signed URL for a photo the buyer purchased', async () => {
      const { photographer, photo, originalUrl } = await seedForeignPhoto();
      const buyer = await createTestUser('TALENT');
      await seedCompletedOrder(buyer.id, photographer.id, photo.id);
      holder.client = await signInAs(buyer.email);

      // Before the fix: the user-scoped `photos!inner` ownership check dropped
      // the row, so a legitimately purchased photo threw "not purchased".
      const url = await getPhotoDownloadUrl(originalUrl);
      expect(url).toBeTruthy();
      expect(url).toContain('token=');
    });

    it('returns a signed URL for a claimed (free) photo — no regression', async () => {
      const buyer = await createTestUser('TALENT');
      const { originalUrl } = await seedClaimedPhoto(buyer.id);
      holder.client = await signInAs(buyer.email);

      expect(await getPhotoDownloadUrl(originalUrl)).toBeTruthy();
    });

    it('rejects a photo the caller did not purchase or claim', async () => {
      const { photographer, photo, originalUrl } = await seedForeignPhoto();
      const buyer = await createTestUser('TALENT');
      const stranger = await createTestUser('TALENT');
      await seedCompletedOrder(buyer.id, photographer.id, photo.id);
      holder.client = await signInAs(stranger.email);

      await expect(getPhotoDownloadUrl(originalUrl)).rejects.toThrow(/not purchased/i);
    });
  });
});
