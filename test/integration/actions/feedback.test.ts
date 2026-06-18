/**
 * Integration tests for `submitFeedbackAction` (feedback page action).
 *
 * Confirms the action persists a feedback row for the authenticated user and
 * rejects unauthenticated callers / incomplete submissions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

vi.mock('@/app/[lang]/actions/roles', () => ({
  getActiveRole: vi.fn(async () => ({ activeRole: mockSession.activeRole })),
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

import { submitFeedbackAction } from '@/app/[lang]/actions/feedback';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

function buildFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('category', 'bug');
  fd.set('rating', '4');
  fd.set('subject', 'Gallery not loading');
  fd.set('description', 'The event gallery shows a blank page.');
  fd.set('role', 'talent');
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

describe('submitFeedbackAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  it('persists a feedback row for the authenticated user', async () => {
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;

    await submitFeedbackAction(buildFormData());

    const sb = createServiceClient();
    const { data } = await sb
      .from('feedback')
      .select('user_id, category, subject, rating')
      .eq('user_id', talent.id);

    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      user_id: talent.id,
      category: 'bug',
      subject: 'Gallery not loading',
      rating: 4,
    });
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(submitFeedbackAction(buildFormData())).rejects.toThrow(/signed in/i);
  });

  it('rejects submissions missing required fields', async () => {
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    await expect(submitFeedbackAction(buildFormData({ subject: '' }))).rejects.toThrow(/required/i);
  });
});
