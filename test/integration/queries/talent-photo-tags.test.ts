import { beforeEach, describe, expect, it } from 'vitest';
import {
  getTaggedPhotosCountForTalent,
  getTaggedPhotosForTalent,
  isPhotoTaggedForTalent,
  tagPhotoForTalent,
  tagPhotosForTalent,
  untagPhotoForTalent,
  untagPhotosForTalent,
} from '@/database/queries/talent-photo-tags';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function setupTagFixtures() {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(photographer.id);
  const photo = await createTestPhoto(event.id);
  const talent = await createTestUser('TALENT');
  return { photographer, event, photo, talent };
}

describe('database/queries/talent-photo-tags', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('tagPhotoForTalent + isPhotoTaggedForTalent', () => {
    it('inserts a tag and is visible via isPhotoTaggedForTalent', async () => {
      const { photographer, photo, talent } = await setupTagFixtures();
      const sb = createServiceClient();
      await tagPhotoForTalent(sb, photo.id, talent.id, photographer.id);
      expect(await isPhotoTaggedForTalent(sb, photo.id, talent.id)).toBe(true);
    });

    it('is idempotent — second insert is a silent no-op (handled 23505)', async () => {
      const { photographer, photo, talent } = await setupTagFixtures();
      const sb = createServiceClient();
      await tagPhotoForTalent(sb, photo.id, talent.id, photographer.id);
      await expect(
        tagPhotoForTalent(sb, photo.id, talent.id, photographer.id),
      ).resolves.not.toThrow();
      expect(await getTaggedPhotosCountForTalent(sb, talent.id)).toBe(1);
    });

    it('isPhotoTaggedForTalent returns false when no tag exists', async () => {
      const { photo, talent } = await setupTagFixtures();
      expect(await isPhotoTaggedForTalent(createServiceClient(), photo.id, talent.id)).toBe(false);
    });
  });

  describe('tagPhotosForTalent (bulk)', () => {
    it('inserts multiple tags in one call and returns the count', async () => {
      const { photographer, event, talent } = await setupTagFixtures();
      const sb = createServiceClient();
      const a = await createTestPhoto(event.id);
      const b = await createTestPhoto(event.id);
      const c = await createTestPhoto(event.id);

      const added = await tagPhotosForTalent(sb, [a.id, b.id, c.id], talent.id, photographer.id);
      expect(added).toBe(3);
      expect(await getTaggedPhotosCountForTalent(sb, talent.id)).toBe(3);
    });

    it('returns 0 for an empty input list (no query)', async () => {
      const { photographer, talent } = await setupTagFixtures();
      expect(await tagPhotosForTalent(createServiceClient(), [], talent.id, photographer.id)).toBe(
        0,
      );
    });

    it('handles duplicates gracefully via onConflict ignoreDuplicates', async () => {
      const { photographer, photo, talent } = await setupTagFixtures();
      const sb = createServiceClient();
      await tagPhotoForTalent(sb, photo.id, talent.id, photographer.id);
      // Tag the same photo again in a bulk call — must not error.
      await expect(
        tagPhotosForTalent(sb, [photo.id], talent.id, photographer.id),
      ).resolves.toBeDefined();
      expect(await getTaggedPhotosCountForTalent(sb, talent.id)).toBe(1);
    });
  });

  describe('untag', () => {
    it('untagPhotoForTalent removes a single tag', async () => {
      const { photographer, photo, talent } = await setupTagFixtures();
      const sb = createServiceClient();
      await tagPhotoForTalent(sb, photo.id, talent.id, photographer.id);

      await untagPhotoForTalent(sb, photo.id, talent.id);

      expect(await isPhotoTaggedForTalent(sb, photo.id, talent.id)).toBe(false);
    });

    it('untagPhotosForTalent removes multiple at once', async () => {
      const { photographer, event, talent } = await setupTagFixtures();
      const sb = createServiceClient();
      const a = await createTestPhoto(event.id);
      const b = await createTestPhoto(event.id);
      await tagPhotosForTalent(sb, [a.id, b.id], talent.id, photographer.id);

      await untagPhotosForTalent(sb, [a.id, b.id], talent.id);

      expect(await getTaggedPhotosCountForTalent(sb, talent.id)).toBe(0);
    });
  });

  describe('getTaggedPhotosCountForTalent', () => {
    it("counts only the asking talent's tags", async () => {
      const { photographer, event, photo, talent } = await setupTagFixtures();
      const otherTalent = await createTestUser('TALENT');
      const otherPhoto = await createTestPhoto(event.id);
      const sb = createServiceClient();
      await tagPhotoForTalent(sb, photo.id, talent.id, photographer.id);
      await tagPhotoForTalent(sb, otherPhoto.id, otherTalent.id, photographer.id);

      expect(await getTaggedPhotosCountForTalent(sb, talent.id)).toBe(1);
      expect(await getTaggedPhotosCountForTalent(sb, otherTalent.id)).toBe(1);
    });

    it('returns 0 when nothing is tagged', async () => {
      const talent = await createTestUser('TALENT');
      expect(await getTaggedPhotosCountForTalent(createServiceClient(), talent.id)).toBe(0);
    });
  });

  describe('deleted events (T-040)', () => {
    it('excludes tagged photos whose event was soft-deleted (list + count)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const liveEvent = await createTestEvent(photographer.id, { name: 'Live' });
      const deadEvent = await createTestEvent(photographer.id, { name: 'Dead' });
      const livePhoto = await createTestPhoto(liveEvent.id);
      const deadPhoto = await createTestPhoto(deadEvent.id);
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      await tagPhotoForTalent(sb, livePhoto.id, talent.id, photographer.id);
      await tagPhotoForTalent(sb, deadPhoto.id, talent.id, photographer.id);

      await sb
        .from('events')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deadEvent.id);

      const tagged = await getTaggedPhotosForTalent(sb, talent.id);
      expect(tagged.map((t) => t.photo_id)).toEqual([livePhoto.id]);
      expect(await getTaggedPhotosCountForTalent(sb, talent.id)).toBe(1);
    });
  });
});
