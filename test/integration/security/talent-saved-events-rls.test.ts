/**
 * RLS regression tests for `talent_saved_events` — a talent's bookmarked
 * events. A talent must only ever read / insert / update / delete their OWN
 * saved-event rows; user_id isolation is enforced as defense in depth behind
 * the server-action role gate.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

describe('talent_saved_events RLS', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks a talent from reading another talent's saved events", async () => {
    const service = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const owner = await createTestUser('TALENT');
    const other = await createTestUser('TALENT');
    await service.from('talent_saved_events').insert({ user_id: owner.id, event_id: event.id });

    const otherClient = await signInAs(other.email);
    const { data } = await otherClient.from('talent_saved_events').select('*');
    expect(data ?? []).toEqual([]);
  });

  it("blocks inserting a saved event under another user's id", async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const attacker = await createTestUser('TALENT');
    const victim = await createTestUser('TALENT');

    const attackerClient = await signInAs(attacker.email);
    const { error } = await attackerClient
      .from('talent_saved_events')
      .insert({ user_id: victim.id, event_id: event.id });
    expect(error?.code).toBe('42501');
  });

  it("blocks deleting another talent's saved event", async () => {
    const service = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const owner = await createTestUser('TALENT');
    const attacker = await createTestUser('TALENT');
    await service.from('talent_saved_events').insert({ user_id: owner.id, event_id: event.id });

    const attackerClient = await signInAs(attacker.email);
    await attackerClient
      .from('talent_saved_events')
      .delete()
      .eq('user_id', owner.id)
      .eq('event_id', event.id);

    // Row must survive — the attacker's delete matched nothing under RLS.
    const { data } = await service.from('talent_saved_events').select('*').eq('user_id', owner.id);
    expect(data ?? []).toHaveLength(1);
  });

  it('allows a talent to save an event for themselves', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const talent = await createTestUser('TALENT');

    const talentClient = await signInAs(talent.email);
    const { error } = await talentClient
      .from('talent_saved_events')
      .insert({ user_id: talent.id, event_id: event.id });
    expect(error).toBeNull();
  });
});
