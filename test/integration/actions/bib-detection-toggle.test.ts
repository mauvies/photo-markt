/**
 * Integration tests for the per-event BIB-detection opt-in actions (T-032)
 * in `app/[lang]/dashboard/photographer/events/[id]/actions.ts`.
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
  disableBibDetectionForEvent,
  enableBibDetectionForEvent,
} from '@/app/[lang]/dashboard/photographer/events/[id]/actions';
import { getEventBibDetectionState } from '@/database/queries/bib-numbers';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('bib-detection opt-in actions (T-032)', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    inngestSend.mockReset();
  });

  it('owner enables: flips the flag and enqueues the backfill event', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    mockSession.userId = owner.id;

    await enableBibDetectionForEvent(event.id);

    const state = await getEventBibDetectionState(createServiceClient(), event.id);
    expect(state?.enabled).toBe(true);
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'event.bib-detection-enabled' }),
    );
  });

  it('owner disables: flips the flag off (no backfill event)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    mockSession.userId = owner.id;
    await enableBibDetectionForEvent(event.id);
    inngestSend.mockReset();

    await disableBibDetectionForEvent(event.id);

    const state = await getEventBibDetectionState(createServiceClient(), event.id);
    expect(state?.enabled).toBe(false);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('rejects a non-owner', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const stranger = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    mockSession.userId = stranger.id;

    // A non-owner can't load the event, so the action rejects before any
    // flag flip or backfill enqueue.
    await expect(enableBibDetectionForEvent(event.id)).rejects.toThrow();
    expect(inngestSend).not.toHaveBeenCalled();
    const state = await getEventBibDetectionState(createServiceClient(), event.id);
    expect(state?.enabled).toBe(false);
  });

  it('rejects enabling on an event that contains minors', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await createServiceClient().from('events').update({ contains_minors: true }).eq('id', event.id);
    mockSession.userId = owner.id;

    await expect(enableBibDetectionForEvent(event.id)).rejects.toThrow(/minors/i);
  });
});
