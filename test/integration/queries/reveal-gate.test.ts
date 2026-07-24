/**
 * Reveal gate (T-177) — `getEventPhotosPublicByIds` is the reload-rehydration
 * query for a gated event: given the proof cookie's photo-id set, it returns
 * ONLY those photos, and only if they're in the approved public set. This is
 * the fail-closed core of "a match reveals the matched photos, not the event":
 * a stale/foreign/pending/deleted id in the proof can never surface a photo.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getEventPhotosPublicByIds } from '@/database/queries/photos';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const sb = createServiceClient();

async function makePhoto(eventId: string, status: string, deleted = false) {
  const { id } = await createTestPhoto(eventId);
  await sb
    .from('photos')
    .update({ upload_status: status, deleted_at: deleted ? new Date().toISOString() : null })
    .eq('id', id);
  return id;
}

describe('getEventPhotosPublicByIds (reveal-gate reload rehydration)', () => {
  beforeEach(() => resetDatabase());

  it('returns only the requested ids, scoped to the approved public set', async () => {
    const { id: userId } = await createTestUser();
    const { id: eventId } = await createTestEvent(userId, { is_public: true });
    const p1 = await makePhoto(eventId, 'approved');
    const p2 = await makePhoto(eventId, 'approved');
    const p3 = await makePhoto(eventId, 'approved');

    const revealed = await getEventPhotosPublicByIds(sb, eventId, [p1, p2]);
    expect(new Set(revealed.map((p) => p.id))).toEqual(new Set([p1, p2]));
    expect(revealed.map((p) => p.id)).not.toContain(p3);
  });

  it('returns [] for an empty id set (fail-closed: no proof ⇒ nothing revealed)', async () => {
    const { id: userId } = await createTestUser();
    const { id: eventId } = await createTestEvent(userId);
    await makePhoto(eventId, 'approved');
    expect(await getEventPhotosPublicByIds(sb, eventId, [])).toEqual([]);
  });

  it('never surfaces a pending, deleted, or foreign-event photo even if its id is in the proof', async () => {
    const { id: userId } = await createTestUser();
    const { id: eventId } = await createTestEvent(userId);
    const approved = await makePhoto(eventId, 'approved');
    const pending = await makePhoto(eventId, 'pending');
    const deleted = await makePhoto(eventId, 'approved', true);

    // A photo that belongs to a DIFFERENT event.
    const { id: otherEventId } = await createTestEvent(userId);
    const foreign = await makePhoto(otherEventId, 'approved');

    const revealed = await getEventPhotosPublicByIds(sb, eventId, [
      approved,
      pending,
      deleted,
      foreign,
    ]);
    expect(revealed.map((p) => p.id)).toEqual([approved]);
  });
});
