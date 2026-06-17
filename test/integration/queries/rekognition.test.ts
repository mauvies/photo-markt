import { beforeEach, describe, expect, it } from 'vitest';
import { addPhotoFace, getPhotoFaceBoxesByStoragePath } from '@/database/queries/rekognition';
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
