/**
 * T-088: cache-tag characterization + regression for `attachPhotosToEvent`
 * (`app/[lang]/dashboard/photographer/events/[id]/upload-urls/actions.ts`).
 *
 * Before this ticket, an upload only revalidated `event-${id|slug|share_code}`
 * — never the owner's own dashboard listing tags — so a freshly-uploaded
 * photo's count/cover stayed stale on the owner's own event list for up to
 * 50 min. Photos always start `pending` on insert (approval happens later in
 * the Inngest worker), so the PUBLIC listing tags (`events-public`,
 * `top-events`, `photographer-${slug}`) deliberately stay untouched here —
 * busting them on every upload of a large batch would thrash those
 * high-traffic caches for no visibility change.
 */

import { revalidateTag } from 'next/cache';
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

const inngestSend = vi.fn();
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: (...a: unknown[]) => inngestSend(...a) },
}));

import { attachPhotosToEvent } from '@/app/[lang]/dashboard/photographer/events/[id]/upload-urls/actions';
import { createTestEvent, createTestUser, resetDatabase } from '../../helpers/supabase-test-client';

describe('cache tag revalidation (attachPhotosToEvent)', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    inngestSend.mockReset();
    vi.mocked(revalidateTag).mockClear();
  });

  function revalidatedTags(): unknown[] {
    return vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
  }

  it("revalidates the owner's dashboard listing tags immediately, since uploaded photos count even while pending", async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    mockSession.userId = owner.id;

    await attachPhotosToEvent({
      eventId: event.id,
      photos: [
        {
          path: `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`,
          originalFilename: 'photo.jpg',
          sizeBytes: 1024,
        },
      ],
    });

    const tags = revalidatedTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        `event-${event.id}`,
        `photographer-events-${owner.id}`,
        `dashboard-photographer-${owner.id}`,
      ]),
    );
  });

  it('does not bust the public listing tags — uploaded photos start pending, so the public approved-photo count has not changed yet', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    mockSession.userId = owner.id;

    await attachPhotosToEvent({
      eventId: event.id,
      photos: [
        {
          path: `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`,
          originalFilename: 'photo.jpg',
          sizeBytes: 1024,
        },
      ],
    });

    const tags = revalidatedTags();
    expect(tags).not.toContain('events-public');
    expect(tags).not.toContain('top-events');
    expect(tags).not.toContain(`photographer-${owner.username}`);
  });
});
