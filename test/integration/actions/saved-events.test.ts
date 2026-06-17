/**
 * Integration tests for saved-events (event bookmark) Server Actions.
 *
 * Covers the auth + TALENT role gate enforced server-side on every mutation,
 * plus the happy-path save/unsave lifecycle and the guest-safe id lookup that
 * powers the client save button.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

// Gating is by CAPABILITY now — mirror the real `userHasRole` against the
// seeded `user_role_memberships`, not the mutable `active_role`.
vi.mock('@/app/[lang]/actions/roles', () => ({
  userHasRole: vi.fn(async (slug: string) => {
    if (!mockSession.userId) return false;
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      'http://127.0.0.1:54321',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data } = await sb
      .from('user_role_memberships')
      .select('role')
      .eq('user_id', mockSession.userId);
    return (data ?? []).some((r: { role: string }) => r.role.toLowerCase() === slug);
  }),
}));

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
        if (!mockSession.userId) {
          return { data: { user: null }, error: null } as never;
        }
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

import {
  getSavedEventIdsAction,
  markEventSeen,
  saveEvent,
  unsaveEvent,
} from '@/app/[lang]/actions/saved-events';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function setup() {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(photographer.id);
  const talent = await createTestUser('TALENT');
  return { photographer, event, talent };
}

describe('saved-events actions', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  describe('saveEvent', () => {
    it('rejects unauthenticated callers', async () => {
      mockSession.userId = null;
      await expect(saveEvent('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/signed in/i);
    });

    it('rejects non-talent callers', async () => {
      const { event, photographer } = await setup();
      mockSession.userId = photographer.id;
      mockSession.activeRole = 'photographer';
      await expect(saveEvent(event.id)).rejects.toThrow(/talent/i);
    });

    it('saves an event for the calling talent', async () => {
      const { event, talent } = await setup();
      mockSession.userId = talent.id;
      await expect(saveEvent(event.id)).resolves.toEqual({ ok: true });

      const service = createServiceClient();
      const { data } = await service
        .from('talent_saved_events')
        .select('*')
        .eq('user_id', talent.id);
      expect(data ?? []).toHaveLength(1);
    });
  });

  describe('unsaveEvent', () => {
    it('removes a saved event', async () => {
      const { event, talent } = await setup();
      mockSession.userId = talent.id;
      await saveEvent(event.id);
      await expect(unsaveEvent(event.id)).resolves.toEqual({ ok: true });

      const service = createServiceClient();
      const { data } = await service
        .from('talent_saved_events')
        .select('*')
        .eq('user_id', talent.id);
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe('markEventSeen', () => {
    it('rejects non-talent callers', async () => {
      const { event, photographer } = await setup();
      mockSession.userId = photographer.id;
      mockSession.activeRole = 'photographer';
      await expect(markEventSeen(event.id)).rejects.toThrow(/talent/i);
    });
  });

  describe('getSavedEventIdsAction', () => {
    it('returns a guest-safe shape for unauthenticated callers', async () => {
      mockSession.userId = null;
      await expect(getSavedEventIdsAction()).resolves.toEqual({
        isTalent: false,
        savedEventIds: [],
      });
    });

    it('returns a non-talent shape for photographers', async () => {
      const { photographer } = await setup();
      mockSession.userId = photographer.id;
      mockSession.activeRole = 'photographer';
      await expect(getSavedEventIdsAction()).resolves.toEqual({
        isTalent: false,
        savedEventIds: [],
      });
    });

    it('returns the saved ids for a talent', async () => {
      const { event, talent } = await setup();
      mockSession.userId = talent.id;
      await saveEvent(event.id);

      const result = await getSavedEventIdsAction();
      expect(result.isTalent).toBe(true);
      expect(result.savedEventIds).toEqual([event.id]);
    });
  });
});
