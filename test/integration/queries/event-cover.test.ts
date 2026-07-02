/**
 * Integration tests for the dedicated event cover image (T-055):
 * `setEventCoverPath` / `getEventCoverPath` / `getEventsCoverPaths`, plus the
 * mechanism the orphan-cleanup cron uses to treat a cover as in-use.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getEventCoverPath,
  getEventsCoverPaths,
  setEventCoverPath,
} from '@/database/queries/events';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('event cover image queries', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('sets and reads back a cover path (owner-scoped)', async () => {
    const db = createServiceClient();
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const coverPath = `${owner.id}/${event.id}/cover-abc.jpg`;

    await setEventCoverPath(db, event.id, owner.id, coverPath);

    expect(await getEventCoverPath(db, event.id)).toBe(coverPath);
    const map = await getEventsCoverPaths(db, [event.id]);
    expect(map.get(event.id)).toBe(coverPath);
  });

  it('does not change the cover when a non-owner tries to set it', async () => {
    const db = createServiceClient();
    const owner = await createTestUser('PHOTOGRAPHER');
    const stranger = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const coverPath = `${owner.id}/${event.id}/cover-abc.jpg`;
    await setEventCoverPath(db, event.id, owner.id, coverPath);

    // Owner-scoped update keyed on user_id — a stranger's id matches no row.
    await setEventCoverPath(db, event.id, stranger.id, `${stranger.id}/x/cover.jpg`);

    expect(await getEventCoverPath(db, event.id)).toBe(coverPath);
  });

  it('clears the cover with null', async () => {
    const db = createServiceClient();
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setEventCoverPath(db, event.id, owner.id, `${owner.id}/${event.id}/cover.jpg`);

    await setEventCoverPath(db, event.id, owner.id, null);

    expect(await getEventCoverPath(db, event.id)).toBeNull();
    expect((await getEventsCoverPaths(db, [event.id])).has(event.id)).toBe(false);
  });

  it('cover paths are discoverable via the cron in-use query (not swept)', async () => {
    // The orphan-cleanup cron marks a storage path in-use when it appears in
    // events.cover_path. This asserts that lookup finds a set cover.
    const db = createServiceClient();
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const coverPath = `${owner.id}/${event.id}/cover-xyz.jpg`;
    await setEventCoverPath(db, event.id, owner.id, coverPath);

    const { data } = await db
      .from('events')
      .select('cover_path')
      .in('cover_path', [coverPath, `${owner.id}/${event.id}/orphan.jpg`]);
    const inUse = new Set((data ?? []).map((r) => r.cover_path));

    expect(inUse.has(coverPath)).toBe(true);
    expect(inUse.has(`${owner.id}/${event.id}/orphan.jpg`)).toBe(false);
  });
});
