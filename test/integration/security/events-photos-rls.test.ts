/**
 * RLS for the event/photo tree (T-227): `events`, `photos`, `photo_faces`,
 * `photo_bib_numbers`.
 *
 * These four were untested, and they are the ones where the policy shape is least
 * obvious:
 *
 *   * `events` / `photos` are owner-only. There is NO public-read policy — public
 *     browsing goes through `service_role` in the server layer. So "anon sees a
 *     public event" is FALSE at the database level, and a future policy that made
 *     it true would be a real change of posture, not a convenience.
 *
 *   * `photo_faces` / `photo_bib_numbers` are the only two-hop policies in the
 *     schema (row → photos → events), and they are STRICTER than they read. Their
 *     `e.is_public = true` branch looks like public access but is unreachable:
 *     policy expressions are evaluated as the calling role, so the nested reads of
 *     `photos` and `events` are RLS-filtered too, and both are owner-only. The
 *     tests below pin the real behaviour and say why, because the policy text
 *     invites the opposite conclusion.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAnonClient,
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

async function seedFace(photoId: string) {
  const { data, error } = await createServiceClient()
    .from('photo_faces')
    .insert({
      photo_id: photoId,
      aws_face_id: `face_${photoId.slice(0, 8)}`,
      aws_collection_id: 'test-collection',
      confidence: 99.5,
      bounding_box: { Left: 0.1, Top: 0.1, Width: 0.2, Height: 0.2 },
    })
    .select()
    .single();
  if (error) throw new Error(`face seed failed: ${error.message}`);
  return data as { id: string };
}

async function seedBib(photoId: string) {
  const { data, error } = await createServiceClient()
    .from('photo_bib_numbers')
    .insert({ photo_id: photoId, bib_text: '1234', confidence: 98 })
    .select()
    .single();
  if (error) throw new Error(`bib seed failed: ${error.message}`);
  return data as { id: string };
}

describe('events / photos RLS', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('another photographer cannot see your events, public or not', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    await createTestEvent(owner.id, { is_public: true });
    const stranger = await createTestUser('PHOTOGRAPHER');

    const { data } = await (await signInAs(stranger.email)).from('events').select('*');

    // `own_rows_select` is `user_id = auth.uid()` with no public-read branch:
    // even an `is_public` event is invisible at the DB level.
    expect(data ?? []).toEqual([]);
  });

  it('anon cannot list events', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    await createTestEvent(owner.id, { is_public: true });

    const { data, error } = await createAnonClient().from('events').select('id');

    expect(data ?? []).toEqual([]);
    if (error) expect(error.code === '42501' || error.code === undefined).toBe(true);
  });

  it('a stranger cannot insert an event owned by someone else', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const stranger = await createTestUser('PHOTOGRAPHER');

    const { error } = await (await signInAs(stranger.email))
      .from('events')
      .insert({ user_id: owner.id, name: 'Injected', date: '2026-01-01' })
      .select();

    expect(error?.code).toBe('42501');
    const { count } = await createServiceClient()
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('name', 'Injected');
    expect(count).toBe(0);
  });

  it('a stranger cannot delete or re-own your photos', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photo = await createTestPhoto(event.id, { user_id: owner.id });
    const stranger = await createTestUser('PHOTOGRAPHER');
    const strangerClient = await signInAs(stranger.email);

    await strangerClient.from('photos').delete().eq('id', photo.id);
    const { data: stolen } = await strangerClient
      .from('photos')
      .update({ user_id: stranger.id })
      .eq('id', photo.id)
      .select();

    expect(stolen ?? []).toEqual([]);
    const { data: after } = await createServiceClient()
      .from('photos')
      .select('user_id')
      .eq('id', photo.id)
      .single();
    expect(after?.user_id).toBe(owner.id);
  });

  it('the owner can still read and mutate their own photos', async () => {
    // Positive control.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photo = await createTestPhoto(event.id, { user_id: owner.id });
    const ownerClient = await signInAs(owner.email);

    const { data: read } = await ownerClient.from('photos').select('id').eq('id', photo.id);
    expect(read).toHaveLength(1);

    const { data: updated } = await ownerClient
      .from('photos')
      .update({ city: 'Madrid' })
      .eq('id', photo.id)
      .select();
    expect(updated).toHaveLength(1);
  });
});

describe('photo_faces / photo_bib_numbers RLS — the two-hop policy', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('anon cannot read faces or bibs — not even for a PUBLIC event', async () => {
    // ⚠️ Reading the policy, you would expect the opposite. It says
    //   EXISTS(photos p JOIN events e … WHERE e.user_id = auth.uid() OR e.is_public)
    // so `is_public` looks like a public-read branch. It is not reachable: a
    // policy expression is evaluated as the CALLING role, so the nested reads of
    // `photos` and `events` are themselves RLS-filtered, and both of those are
    // owner-only (`user_id = auth.uid()`). For anon the subquery sees no event at
    // all, so `e.is_public` is never evaluated on a visible row.
    //
    // That is why `orders` reaches for a SECURITY DEFINER helper
    // (`order_has_photographer_items`) to express its photographer branch — a
    // plain nested EXISTS could not have.
    //
    // Harmless today: face search reads these through `supabaseAdmin`
    // (`events/[shareCode]/actions.ts` passes `adminClient`), so no feature
    // depends on the dead branch. Pinned because the policy READS as though anon
    // access were intended, and the next person to build on that reading should
    // find this test instead of a surprise.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { is_public: true });
    const photo = await createTestPhoto(event.id, { user_id: owner.id });
    await seedFace(photo.id);
    await seedBib(photo.id);

    const anon = createAnonClient();
    const { data: faces } = await anon.from('photo_faces').select('id').eq('photo_id', photo.id);
    const { data: bibs } = await anon
      .from('photo_bib_numbers')
      .select('id')
      .eq('photo_id', photo.id);

    expect(faces ?? []).toEqual([]);
    expect(bibs ?? []).toEqual([]);
  });

  it('another photographer cannot read your face or bib rows', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { is_public: true });
    const photo = await createTestPhoto(event.id, { user_id: owner.id });
    await seedFace(photo.id);
    const stranger = await createTestUser('PHOTOGRAPHER');

    const { data } = await (await signInAs(stranger.email))
      .from('photo_faces')
      .select('id')
      .eq('photo_id', photo.id);

    expect(data ?? []).toEqual([]);
  });

  it('the event owner CAN read their own face and bib rows', async () => {
    // Positive control: without it the three denial tests above would also pass
    // against a policy that denies everyone, and the two-hop expression would be
    // untested rather than proven.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { is_public: false });
    const photo = await createTestPhoto(event.id, { user_id: owner.id });
    await seedFace(photo.id);
    await seedBib(photo.id);
    const ownerClient = await signInAs(owner.email);

    const { data: faces } = await ownerClient
      .from('photo_faces')
      .select('id')
      .eq('photo_id', photo.id);
    const { data: bibs } = await ownerClient
      .from('photo_bib_numbers')
      .select('id')
      .eq('photo_id', photo.id);

    expect(faces).toHaveLength(1);
    expect(bibs).toHaveLength(1);
  });

  it('soft-deleting the event hides its face rows from the owner too', async () => {
    // The `e.deleted_at IS NULL` half of the policy, tested from the one
    // perspective that can actually reach the row.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { is_public: true });
    const photo = await createTestPhoto(event.id, { user_id: owner.id });
    await seedFace(photo.id);
    await createServiceClient()
      .from('events')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', event.id);

    const { data } = await (await signInAs(owner.email))
      .from('photo_faces')
      .select('id')
      .eq('photo_id', photo.id);

    expect(data ?? []).toEqual([]);
  });

  it('nobody but the service role can write face or bib rows', async () => {
    // Both tables are written only by the Inngest workers. A user-authored insert
    // would let anyone claim a face match on someone else's photo.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { is_public: true });
    const photo = await createTestPhoto(event.id, { user_id: owner.id });
    const ownerClient = await signInAs(owner.email);

    const { error: faceError } = await ownerClient
      .from('photo_faces')
      .insert({
        photo_id: photo.id,
        aws_face_id: 'forged',
        aws_collection_id: 'x',
        confidence: 99,
      })
      .select();
    const { error: bibError } = await ownerClient
      .from('photo_bib_numbers')
      .insert({ photo_id: photo.id, bib_text: '9999', confidence: 99 })
      .select();

    expect(faceError?.code).toBe('42501');
    expect(bibError?.code).toBe('42501');
  });
});
