/**
 * Regression tests for `buildOwnerPhotoAlbumItem`.
 *
 * The photographer's own event grid renders `thumbMedium ?? url`. Before this
 * fix the owner builder emitted only `url` (the full-res signed original), so
 * the grid fell back to it and the Next.js image optimizer timed out fetching
 * multi-MB files. The builder must emit the immutable `/api/thumb` URLs (which
 * `shouldSkipImageOptimization` bypasses) once the thumbnail is baked, exactly
 * like the public builder.
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
};

describe('buildOwnerPhotoAlbumItem', () => {
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

  it('returns null when the photo has no signed URL', () => {
    expect(buildOwnerPhotoAlbumItem(makePhoto(), { ...opts, signed: {} })).toBeNull();
  });
});
