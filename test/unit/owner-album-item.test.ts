/**
 * Regression tests for `buildOwnerPhotoAlbumItem`.
 *
 * The photographer's own event grid renders `thumbMedium ?? url`. When the event
 * has no watermark, the owner builder emits the immutable `/api/thumb` URLs
 * (which `shouldSkipImageOptimization` bypasses) once the thumbnail is baked, so
 * the grid never falls back to the full-res signed original and the Next.js
 * image optimizer never times out on multi-MB files.
 *
 * When the event HAS a watermark, the baked thumbnail is watermarked (a role-
 * agnostic content-addressed artifact with no un-watermarked variant), so the
 * builder must NOT emit it — the owner has to see their real, un-watermarked
 * material. It falls back to the signed original and flags it `unoptimized` so
 * the optimizer doesn't time out on it (T-110).
 */

import { describe, expect, it } from 'vitest';
import { buildOwnerPhotoAlbumItem } from '@/app/[lang]/dashboard/photographer/events/[id]/owner-album-item';
import type { PhotoDetail } from '@/database/queries/photos';
import { shouldSkipImageOptimization } from '@/lib/image-source';

const ORIGINAL_PATH = 'owner-id/event-id/photo-1.jpg';
const SIGNED_ORIGINAL = `https://ref.supabase.co/storage/v1/object/sign/photos/${ORIGINAL_PATH}?token=abc`;

function makePhoto(overrides: Partial<PhotoDetail> = {}): PhotoDetail {
  return {
    id: 'photo-1',
    original_url: ORIGINAL_PATH,
    taken_at: null,
    city: null,
    country: null,
    state: null,
    width: 4000,
    height: 3000,
    ...overrides,
  };
}

const opts = {
  signed: { [ORIGINAL_PATH]: SIGNED_ORIGINAL },
  uploaderProfiles: {},
  tags: {},
  watermarkEnabled: false,
};

describe('buildOwnerPhotoAlbumItem', () => {
  describe('watermark disabled', () => {
    it('emits optimizer-skippable /api/thumb URLs when the thumbnail is ready', () => {
      const item = buildOwnerPhotoAlbumItem(
        makePhoto({ thumbnail_status: 'ready', thumb_version: 3 }),
        opts,
      );

      expect(item).not.toBeNull();
      // The grid uses thumbMedium as its src; it must be the immutable /api/thumb
      // URL, not the signed original that times out under the optimizer.
      expect(item?.thumbMedium).toMatch(/^\/api\/thumb\//);
      expect(item?.thumbSmall).toMatch(/^\/api\/thumb\//);
      expect(shouldSkipImageOptimization(item?.thumbMedium ?? '')).toBe(true);
      // thumb_version threads through as the CDN cache-bust (T-078).
      expect(item?.thumbMedium).toContain('v=3');
      // The full-res signed original is still carried for the lightbox.
      expect(item?.url).toBe(SIGNED_ORIGINAL);
      // The optimizer-skip flag isn't forced — the /api/thumb URL handles it.
      expect(item?.unoptimized).toBeUndefined();
    });

    it('omits thumb URLs until the thumbnail is baked (grid falls back to the signed original)', () => {
      const pending = buildOwnerPhotoAlbumItem(makePhoto({ thumbnail_status: 'pending' }), opts);
      expect(pending?.thumbMedium).toBeUndefined();
      expect(pending?.thumbSmall).toBeUndefined();
      expect(pending?.url).toBe(SIGNED_ORIGINAL);

      // No status at all (legacy row) is treated the same way.
      const legacy = buildOwnerPhotoAlbumItem(makePhoto(), opts);
      expect(legacy?.thumbMedium).toBeUndefined();
    });
  });

  describe('watermark enabled (T-110)', () => {
    const watermarked = { ...opts, watermarkEnabled: true };

    it('never emits the watermarked /api/thumb URLs, even once baked', () => {
      // The grid renders `thumbMedium ?? url`. When the thumbnail is baked WITH a
      // watermark, emitting it would show the owner their own photos watermarked
      // (the reported bug). The builder must drop the thumb so the grid/lightbox
      // fall back to the un-watermarked signed original.
      const item = buildOwnerPhotoAlbumItem(
        makePhoto({ thumbnail_status: 'ready', thumb_version: 3 }),
        watermarked,
      );

      expect(item).not.toBeNull();
      expect(item?.thumbMedium).toBeUndefined();
      expect(item?.thumbSmall).toBeUndefined();
      // The effective grid src is the un-watermarked signed original.
      expect(item?.url).toBe(SIGNED_ORIGINAL);
    });

    it('flags the signed original `unoptimized` so the optimizer never times out on it', () => {
      const item = buildOwnerPhotoAlbumItem(
        makePhoto({ thumbnail_status: 'ready', thumb_version: 3 }),
        watermarked,
      );

      // The signed original is not an /api/ or localhost URL, so the URL-based
      // heuristic would send it through the optimizer (and time out on large
      // files). The explicit flag keeps it out.
      expect(shouldSkipImageOptimization(item?.url ?? '')).toBe(false);
      expect(item?.unoptimized).toBe(true);
    });
  });

  it('returns null when the photo has no signed URL', () => {
    expect(buildOwnerPhotoAlbumItem(makePhoto(), { ...opts, signed: {} })).toBeNull();
  });
});
