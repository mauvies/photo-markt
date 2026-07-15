/**
 * Tests for the T-132 access rule in `src/database/queries/photos.ts`:
 * `isEventAccessible` (pure) and its batch companion `getAccessiblePhotoIds`.
 *
 * Access is distinct from purchasability (T-117): a private event
 * (`is_public = false`) is reachable only through its `share_code`, so a photo
 * is buyable iff its event is public OR the caller presents a share code
 * matching that event's own code. This is the single rule every cart-entry and
 * checkout boundary shares.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getAccessiblePhotoIds, isEventAccessible } from '@/database/queries/photos';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('isEventAccessible (pure)', () => {
  it('always accessible for a public event, regardless of codes', () => {
    expect(isEventAccessible({ is_public: true, share_code: 'X' }, [])).toBe(true);
    expect(isEventAccessible({ is_public: true, share_code: null }, [])).toBe(true);
  });

  it('private event accessible only with a matching share code', () => {
    expect(isEventAccessible({ is_public: false, share_code: 'CODE' }, ['CODE'])).toBe(true);
    expect(isEventAccessible({ is_public: false, share_code: 'CODE' }, ['OTHER', 'CODE'])).toBe(
      true,
    );
  });

  it('private event NOT accessible without / with the wrong code', () => {
    expect(isEventAccessible({ is_public: false, share_code: 'CODE' }, [])).toBe(false);
    expect(isEventAccessible({ is_public: false, share_code: 'CODE' }, ['WRONG'])).toBe(false);
  });

  it('private event with a null share code is never accessible (no code can match)', () => {
    expect(isEventAccessible({ is_public: false, share_code: null }, [''])).toBe(false);
  });
});

describe('getAccessiblePhotoIds', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns an empty set for empty input', async () => {
    expect(await getAccessiblePhotoIds(createServiceClient(), [], [])).toEqual(new Set());
  });

  it('includes public-event photos with no codes presented', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { is_public: true });
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });

    const result = await getAccessiblePhotoIds(createServiceClient(), [photo.id], []);

    expect(result.has(photo.id)).toBe(true);
  });

  it('excludes a private-event photo when no matching code is presented', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, {
      is_public: false,
      share_code: 'SECRET1',
    });
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const sb = createServiceClient();

    expect((await getAccessiblePhotoIds(sb, [photo.id], [])).has(photo.id)).toBe(false);
    expect((await getAccessiblePhotoIds(sb, [photo.id], ['WRONG'])).has(photo.id)).toBe(false);
    expect((await getAccessiblePhotoIds(sb, [photo.id], ['SECRET1'])).has(photo.id)).toBe(true);
  });

  it('binds each code to its own event in a mixed batch (a code never unlocks another event)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const publicEvent = await createTestEvent(photographer.id, { is_public: true });
    const privA = await createTestEvent(photographer.id, {
      is_public: false,
      share_code: 'CODE_A',
    });
    const privB = await createTestEvent(photographer.id, {
      is_public: false,
      share_code: 'CODE_B',
    });
    const publicPhoto = await createTestPhoto(publicEvent.id, { user_id: photographer.id });
    const photoA = await createTestPhoto(privA.id, { user_id: photographer.id });
    const photoB = await createTestPhoto(privB.id, { user_id: photographer.id });

    // Present only CODE_A: the public photo and photo A are accessible; photo B
    // (a different private event) is not, even though it rode in the same batch.
    const result = await getAccessiblePhotoIds(
      createServiceClient(),
      [publicPhoto.id, photoA.id, photoB.id],
      ['CODE_A'],
    );

    expect(result.has(publicPhoto.id)).toBe(true);
    expect(result.has(photoA.id)).toBe(true);
    expect(result.has(photoB.id)).toBe(false);
  });
});
