/**
 * Integration test for the event-edit photo previews (T-063).
 *
 * The `photos` bucket is private with no storage RLS grant for `authenticated`,
 * so signing photo paths with a user-scoped client returns null URLs and the
 * edit grid shows "No preview" for every photo. `getEditEventPhotos` must sign
 * with the service-role client. This test pins that:
 *   - service-role signing → non-null signed url (fix)
 *   - anon signing of the same path → null url (the pre-fix breakage)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getEditEventPhotos } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/photo-data';
import { createSignedUrls } from '@/database/queries';
import type { SupabaseServerClient } from '@/database/queries/types';
import {
  createAnonClient,
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('getEditEventPhotos (T-063)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
  });

  it('signs previews with the service-role client (anon signing would be null)', async () => {
    const sb = createServiceClient();
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    // Upload a real object so the signed URL points at existing bytes.
    const path = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // minimal jpeg-ish
    const up = await sb.storage.from('photos').upload(path, bytes, { contentType: 'image/jpeg' });
    expect(up.error).toBeNull();

    await sb
      .from('photos')
      .insert({
        user_id: owner.id,
        event_id: event.id,
        original_url: path,
        taken_at: new Date().toISOString(),
        city: 'Barcelona',
        country: 'ES',
        upload_status: 'approved',
      })
      .throwOnError();

    // Fix: service-role signing yields a usable preview URL.
    const photos = await getEditEventPhotos(
      sb as unknown as SupabaseServerClient,
      event.id,
      owner.id,
    );
    expect(photos).toHaveLength(1);
    expect(typeof photos[0]?.url).toBe('string');
    expect(photos[0]?.url).toContain(path);

    // Pre-fix breakage: signing the same path with a user-scoped (anon) client
    // yields no URL — which is why the grid rendered "No preview" for all.
    const anonSigned = await createSignedUrls(
      createAnonClient() as unknown as SupabaseServerClient,
      'photos',
      [path],
      3600,
    );
    expect(anonSigned[0]?.signedUrl ?? null).toBeNull();
  });
});
