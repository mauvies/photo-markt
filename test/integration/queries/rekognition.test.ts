import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPhotoFace,
  getEventAiIndexingProgress,
  getPhotoFaceBoxesByStoragePath,
} from '@/database/queries/rekognition';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('database/queries/rekognition — getPhotoFaceBoxesByStoragePath', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns the bounding boxes for a photo addressed by its storage path', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const storagePath = `${photographer.id}/${event.id}/face.jpg`;
    const photo = await createTestPhoto(event.id, { original_url: storagePath });

    await addPhotoFace(sb, {
      photoId: photo.id,
      awsFaceId: 'face-1',
      awsCollectionId: 'col-1',
      confidence: 99.5,
      boundingBox: { Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.4 },
    });

    const boxes = await getPhotoFaceBoxesByStoragePath(sb, storagePath);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].confidence).toBeCloseTo(99.5);
    expect(boxes[0].boundingBox).toMatchObject({ Width: 0.3, Height: 0.4 });
  });

  it('returns [] for a photo with no indexed faces', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const storagePath = `${photographer.id}/${event.id}/nofaces.jpg`;
    await createTestPhoto(event.id, { original_url: storagePath });

    expect(await getPhotoFaceBoxesByStoragePath(createServiceClient(), storagePath)).toEqual([]);
  });

  it('returns [] when no photo matches the storage path', async () => {
    expect(
      await getPhotoFaceBoxesByStoragePath(createServiceClient(), 'nobody/nothing/ghost.jpg'),
    ).toEqual([]);
  });
});

/**
 * T-209: `totalApplicable` alone made "no photos at all" and "photos the worker
 * opted out of" render as the same "0 of 0". The progress payload has to keep
 * those apart, which is what `totalPhotos` is for.
 */
describe('database/queries/rekognition — getEventAiIndexingProgress (T-209)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setFaceStatus(photoId: string, status: string): Promise<void> {
    const { error } = await createServiceClient()
      .from('photos')
      .update({ face_index_status: status })
      .eq('id', photoId);
    if (error) throw new Error(error.message);
  }

  it('reports an event with no photos as empty on every count', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);

    const progress = await getEventAiIndexingProgress(createServiceClient(), event.id);
    expect(progress.totalPhotos).toBe(0);
    expect(progress.totalApplicable).toBe(0);
  });

  it('still reports the photos when every one is not_applicable', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const a = await createTestPhoto(event.id);
    const b = await createTestPhoto(event.id);
    await setFaceStatus(a.id, 'not_applicable');
    await setFaceStatus(b.id, 'not_applicable');

    const progress = await getEventAiIndexingProgress(createServiceClient(), event.id);
    // The staging repro: photos exist, nothing is queued. Before T-209 this was
    // indistinguishable from an event with no photos at all.
    expect(progress.totalApplicable).toBe(0);
    expect(progress.totalPhotos).toBe(2);
  });

  it('counts a freshly created photo as applicable (the column defaults to pending)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    await createTestPhoto(event.id);

    const progress = await getEventAiIndexingProgress(createServiceClient(), event.id);
    // This is why there is no "the worker never touched it" case: an untouched
    // row is `pending`, so it already reads "0 of 1" rather than "0 of 0".
    expect(progress.totalPhotos).toBe(1);
    expect(progress.totalApplicable).toBe(1);
    expect(progress.pending).toBe(1);
  });

  it('counts a real queue, with totalPhotos spanning both halves', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const indexed = await createTestPhoto(event.id);
    const skipped = await createTestPhoto(event.id);
    await setFaceStatus(indexed.id, 'indexed');
    await setFaceStatus(skipped.id, 'not_applicable');

    const progress = await getEventAiIndexingProgress(createServiceClient(), event.id);
    expect(progress.totalPhotos).toBe(2);
    expect(progress.totalApplicable).toBe(1);
    expect(progress.indexed).toBe(1);
  });
});
