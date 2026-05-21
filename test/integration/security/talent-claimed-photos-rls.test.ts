/**
 * RLS regression tests for `talent_claimed_photos` — the talent's claimed
 * (owned) free photos. A talent must only ever read and insert their OWN
 * claim rows; the table has no UPDATE/DELETE policy (claiming is add-only).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

describe('talent_claimed_photos RLS', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks a talent from reading another talent's claims", async () => {
    const service = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const photo = await createTestPhoto(event.id);
    const owner = await createTestUser('TALENT');
    const other = await createTestUser('TALENT');
    await service
      .from('talent_claimed_photos')
      .insert({ photo_id: photo.id, talent_user_id: owner.id });

    const otherClient = await signInAs(other.email);
    const { data } = await otherClient.from('talent_claimed_photos').select('*');
    expect(data ?? []).toEqual([]);
  });

  it("blocks inserting a claim under another user's id", async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const photo = await createTestPhoto(event.id);
    const attacker = await createTestUser('TALENT');
    const victim = await createTestUser('TALENT');

    const attackerClient = await signInAs(attacker.email);
    const { error } = await attackerClient
      .from('talent_claimed_photos')
      .insert({ photo_id: photo.id, talent_user_id: victim.id });
    expect(error?.code).toBe('42501');
  });

  it('allows a talent to claim a photo for themselves', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: null });
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');

    const talentClient = await signInAs(talent.email);
    const { error } = await talentClient
      .from('talent_claimed_photos')
      .insert({ photo_id: photo.id, talent_user_id: talent.id });
    expect(error).toBeNull();
  });
});
