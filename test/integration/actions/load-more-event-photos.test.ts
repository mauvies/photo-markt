/**
 * Integration tests for the public/talent "Load more" Server Action
 * `loadMoreEventPhotos` (T-060) in `app/[lang]/events/[shareCode]/actions.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: vi.fn(
    async () => new Headers({ host: '127.0.0.1:3000', 'x-forwarded-for': '203.0.113.9' }),
  ),
}));

import { loadMoreEventPhotos } from '@/app/[lang]/events/[shareCode]/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function insertApprovedPhoto(
  sb: SupabaseClient,
  eventId: string,
  ownerId: string,
  takenAt: string,
): Promise<string> {
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: ownerId,
      event_id: eventId,
      original_url: `${ownerId}/${eventId}/${crypto.randomUUID()}.jpg`,
      taken_at: takenAt,
      city: 'Barcelona',
      country: 'ES',
      state: 'Catalonia',
      upload_status: 'approved',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertApprovedPhoto: ${error?.message ?? 'no data'}`);
  return data.id as string;
}

describe('loadMoreEventPhotos (T-060)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
  });

  it('slices from the given offset and reports hasMore + nextOffset', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, {
      share_code: 'LMORE1',
      // Past date so the gallery renders (not "upcoming").
      date: '2026-01-01',
    });
    const sb = createServiceClient();
    // Watermark on → deterministic /api/watermark/ URLs regardless of storage.
    await sb.from('events').update({ watermark_enabled: true }).eq('id', event.id);

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        await insertApprovedPhoto(sb, event.id, owner.id, `2026-01-0${i + 1}T10:00:00.000Z`),
      );
    }

    // Offset 1 with a page big enough to reach the end.
    const res = await loadMoreEventPhotos('LMORE1', 1);
    expect(res.items.map((i) => i.id)).toEqual(ids.slice(1));
    expect(res.hasMore).toBe(false);
    expect(res.nextOffset).toBe(1 + 2);
    // Watermark honored.
    for (const item of res.items) {
      expect(item.url).toContain('/api/watermark/');
    }
  });

  it('short-circuits to an empty result for an upcoming event', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, {
      share_code: 'LMORE2',
      date: '2999-01-01',
    });
    const sb = createServiceClient();
    await insertApprovedPhoto(sb, event.id, owner.id, '2026-01-01T10:00:00.000Z');

    const res = await loadMoreEventPhotos('LMORE2', 0);
    expect(res.items).toEqual([]);
    expect(res.hasMore).toBe(false);
  });

  it('throws for an unknown event reference', async () => {
    await expect(loadMoreEventPhotos('NOPE-NO-SUCH-CODE', 0)).rejects.toThrow(/not found/i);
  });
});
