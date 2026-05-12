/**
 * Integration tests for cart Server Actions.
 *
 * Pattern (proof-of-concept for future Server Action tests):
 *   1. `vi.mock('@/database/server')` — replace the cookie-backed
 *      `createClient` with a service-role client. Cookies/Next.js render
 *      context aren't available outside of a real request, so we stub.
 *   2. `vi.mock('@/app/[lang]/actions/roles')` — `getActiveRole` reads
 *      cookies too. Stub it to return whatever role the test needs.
 *   3. Seed test data via the shared helpers, then call the Server Action
 *      directly as a plain function.
 *   4. Assert DB side-effects via a fresh service-role client.
 *
 * Trade-off: this mocks more than an end-to-end approach (which would
 * spin up `next dev`), but it stays in-process and runs in ~100 ms.
 * Refactoring the actions to accept a client as a parameter would remove
 * the need for the `@/database/server` mock — worth doing if/when we want
 * to test the same flows under real cookie-based auth.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

// Inline `vi.mock` declarations — Vitest only hoists them when they appear
// at the top level of the test file. See `test/helpers/server-action-mocks.ts`
// for the rationale and the canonical block to copy.

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
          data: { user: { id: mockSession.userId, email: `${mockSession.userId}@picdemi.test` } },
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

import {
  addPhotoToCartAction,
  clearCartAction,
  getCartItemCountAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import { getOrCreateCart } from '@/database/queries/carts';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('cart Server Actions', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  describe('addPhotoToCartAction', () => {
    it("inserts the photo into the user's cart at the event price", async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 7 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(photo.id);

      // Verify the cart_item landed with the right price (7.00 → 700 cents).
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const { data: items } = await sb
        .from('cart_items')
        .select('photo_id, photographer_id, unit_price_cents')
        .eq('cart_id', cart.id);
      expect(items).toHaveLength(1);
      expect(items?.[0]?.photo_id).toBe(photo.id);
      expect(items?.[0]?.photographer_id).toBe(photographer.id);
      expect(items?.[0]?.unit_price_cents).toBe(700);
    });

    it('rejects when the user is unauthenticated', async () => {
      mockSession.userId = null;
      await expect(addPhotoToCartAction('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        /signed in/i,
      );
    });

    it('rejects when the user is currently in photographer mode', async () => {
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      mockSession.activeRole = 'photographer';
      await expect(addPhotoToCartAction('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        /talent users/i,
      );
    });

    it('rejects when the photo does not exist', async () => {
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await expect(addPhotoToCartAction('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        /not found/i,
      );
    });

    it('stores 0 cents for a free event (price_per_photo = null)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: null });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(photo.id);

      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const { data: items } = await sb
        .from('cart_items')
        .select('unit_price_cents')
        .eq('cart_id', cart.id);
      expect(items?.[0]?.unit_price_cents).toBe(0);
    });
  });

  describe('removePhotoFromCartAction', () => {
    it('removes a previously-added photo from the cart', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(photo.id);
      expect(await getCartItemCountAction()).toBe(1);

      await removePhotoFromCartAction(photo.id);
      expect(await getCartItemCountAction()).toBe(0);
    });
  });

  describe('clearCartAction', () => {
    it('drops every cart_item for the current user', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const a = await createTestPhoto(event.id);
      const b = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(a.id);
      await addPhotoToCartAction(b.id);
      expect(await getCartItemCountAction()).toBe(2);

      await clearCartAction();
      expect(await getCartItemCountAction()).toBe(0);
    });
  });

  describe('getCartItemCountAction', () => {
    it('returns 0 for unauthenticated callers without throwing', async () => {
      mockSession.userId = null;
      expect(await getCartItemCountAction()).toBe(0);
    });

    it('returns 0 when the caller is in photographer mode (cart is talent-only)', async () => {
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      mockSession.activeRole = 'photographer';
      expect(await getCartItemCountAction()).toBe(0);
    });
  });
});
