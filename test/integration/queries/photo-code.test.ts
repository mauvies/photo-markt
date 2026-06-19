/**
 * Per-event photo code: auto-assigned `sequence` (DB trigger) + editable
 * `label` via the owner-scoped `updatePhotoLabel` query. See change
 * `photo-event-code` (ticket T-011).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { updatePhotoLabel } from '@/database/queries/photos';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function readField<T>(photoId: string, field: 'sequence' | 'label'): Promise<T | null> {
  const sb = createServiceClient();
  const { data } = await sb.from('photos').select(field).eq('id', photoId).single();
  return ((data as Record<string, unknown> | null)?.[field] as T | null) ?? null;
}

describe('photo code (sequence + label)', () => {
  beforeEach(() => resetDatabase());

  it('auto-assigns an increasing per-event sequence on insert', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const p1 = await createTestPhoto(event.id);
    const p2 = await createTestPhoto(event.id);
    const p3 = await createTestPhoto(event.id);

    expect(await readField<number>(p1.id, 'sequence')).toBe(1);
    expect(await readField<number>(p2.id, 'sequence')).toBe(2);
    expect(await readField<number>(p3.id, 'sequence')).toBe(3);
  });

  it('does not reuse a deleted number — gaps are allowed', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const p1 = await createTestPhoto(event.id);
    const p2 = await createTestPhoto(event.id);

    const sb = createServiceClient();
    await sb.from('photos').delete().eq('id', p2.id);

    const p3 = await createTestPhoto(event.id);
    expect(await readField<number>(p1.id, 'sequence')).toBe(1);
    expect(await readField<number>(p3.id, 'sequence')).toBe(3);
  });

  it('numbers each event independently', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const e1 = await createTestEvent(owner.id);
    const e2 = await createTestEvent(owner.id);
    const a = await createTestPhoto(e1.id);
    const b = await createTestPhoto(e2.id);

    expect(await readField<number>(a.id, 'sequence')).toBe(1);
    expect(await readField<number>(b.id, 'sequence')).toBe(1);
  });

  it('updatePhotoLabel sets and clears the label for the owner', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photo = await createTestPhoto(event.id);
    const sb = createServiceClient();

    await updatePhotoLabel(sb, photo.id, event.id, owner.id, 'BIB 42');
    expect(await readField<string>(photo.id, 'label')).toBe('BIB 42');

    await updatePhotoLabel(sb, photo.id, event.id, owner.id, null);
    expect(await readField<string>(photo.id, 'label')).toBeNull();
  });

  it('updatePhotoLabel does not touch a photo owned by another user', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const stranger = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photo = await createTestPhoto(event.id);
    const sb = createServiceClient();

    // Owner-scoped query: a non-owner userId matches zero rows, no change.
    await updatePhotoLabel(sb, photo.id, event.id, stranger.id, 'HACKED');
    expect(await readField<string>(photo.id, 'label')).toBeNull();
  });
});
