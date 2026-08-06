/**
 * Coverage for the AI-matching enqueue actions in
 * `app/[lang]/dashboard/photographer/events/[id]/actions.ts`
 * (`enableAIMatchingForEvent`, `reindexEvent`) — previously untested.
 *
 * The T-089 double-click de-duplication lives in the backfill worker's
 * `debounce` config (asserted in the backfill integration tests), not in
 * these sends, so these tests only pin that the actions flip state and
 * enqueue the trigger event.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

vi.mock('@/database/server', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    createClient: vi.fn(async () => {
      const sb = createClient(
        'http://127.0.0.1:54321',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      sb.auth.getUser = vi.fn(async () => {
        if (!mockSession.userId) return { data: { user: null }, error: null } as never;
        return {
          data: {
            user: { id: mockSession.userId, email: `${mockSession.userId}@photomarkt.test` },
          },
          error: null,
        } as never;
      });
      return sb;
    }),
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

const inngestSend = vi.fn();
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: (...a: unknown[]) => inngestSend(...a) },
}));

import {
  enableAIMatchingForEvent,
  reindexEvent,
} from '@/app/[lang]/dashboard/photographer/events/[id]/actions';
import {
  getEventRekognitionState,
  updateEventRekognitionState,
} from '@/database/queries/rekognition';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('AI-matching enqueue actions', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    inngestSend.mockReset();
  });

  it('enableAIMatchingForEvent flips the flag and enqueues the backfill trigger', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    mockSession.userId = owner.id;

    await enableAIMatchingForEvent(event.id);

    const state = await getEventRekognitionState(createServiceClient(), event.id);
    expect(state?.enabled).toBe(true);
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'event.ai-matching-enabled',
        data: { eventId: event.id, userId: owner.id },
      }),
    );
  });

  it('rejects enabling on an event that contains minors', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await createServiceClient().from('events').update({ contains_minors: true }).eq('id', event.id);
    mockSession.userId = owner.id;

    await expect(enableAIMatchingForEvent(event.id)).rejects.toThrow(/minors/i);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('reindexEvent enqueues the backfill trigger when AI matching is enabled', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await updateEventRekognitionState(createServiceClient(), event.id, { enabled: true });
    mockSession.userId = owner.id;

    await reindexEvent(event.id);

    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'event.ai-matching-enabled' }),
    );
  });

  it('reindexEvent refuses when AI matching is not enabled', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id); // ai_matching_enabled defaults false
    mockSession.userId = owner.id;

    await expect(reindexEvent(event.id)).rejects.toThrow(/enabled/i);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  // T-235: the reported production failure. `requireEventOwner` reads the event
  // with `getEvent`, which used to re-throw PostgREST's PGRST116 for a
  // not-found/not-yours row — so its own `if (!event) throw 'Event not found.'`
  // never ran and the photographer got "Cannot coerce the result to a single
  // JSON object" instead of an explanation.
  it('reindexEvent reports a plain "not found" for an event the caller does not own', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const stranger = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await updateEventRekognitionState(createServiceClient(), event.id, { enabled: true });
    mockSession.userId = stranger.id;

    await expect(reindexEvent(event.id)).rejects.toThrow(/not found/i);
    await expect(reindexEvent(event.id)).rejects.not.toThrow(/coerce/i);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('reindexEvent reports a plain "not found" for an event id that does not exist', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = owner.id;

    await expect(reindexEvent('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      /not found/i,
    );
    expect(inngestSend).not.toHaveBeenCalled();
  });
});
