/**
 * Integration tests for the watermark rule across both event actions (T-211).
 *
 * `createEvent` exempts organizer events from "private ⇒ no watermark" because
 * organizer events are ALWAYS private — access is the membership join table,
 * not a public URL — so without the exception none of them could ever be
 * watermarked. `updateEventAction` was missing that branch, so a private
 * organizer event created WITH a watermark lost it the first time any edit was
 * saved, including an edit that never touched the field.
 *
 * The other half of the ticket is a guard, not a fix: the rule itself is
 * deliberate and stays. A private solo event must still be forced to false even
 * when a hand-crafted POST says otherwise — the disabled switch in the form is
 * UX, and the server remains the authority.
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
  updateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3000' })),
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
    getAll: vi.fn(() => []),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

import { updateEventAction } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/actions';
import { createEvent } from '@/app/[lang]/dashboard/photographer/events/new/actions';
import {
  createServiceClient,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

function buildEventFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    name: 'Watermark Event',
    activity: 'SURF',
    date: '2026-06-15',
    country: 'ES',
    state: 'Catalonia',
    city: 'Barcelona',
    event_type: 'solo',
    is_public: 'true',
    watermark_enabled: 'true',
    is_collaborative: 'false',
    allow_guest_upload: 'true',
    require_upload_approval: 'false',
    price_per_photo: '5.00',
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) fd.append(k, v);
  return fd;
}

async function readEvent(eventId: string) {
  const sb = createServiceClient();
  const { data } = await sb
    .from('events')
    .select('watermark_enabled, is_public, type, name')
    .eq('id', eventId)
    .single();
  return data as {
    watermark_enabled: boolean;
    is_public: boolean;
    type: string | null;
    name: string;
  };
}

beforeEach(async () => {
  await resetDatabase();
  await ensurePhotosBucket();
  const user = await createTestUser('PHOTOGRAPHER');
  mockSession.userId = user.id;
  mockSession.activeRole = 'photographer';
});

describe('createEvent — watermark rule', () => {
  it('keeps the watermark on a private organizer event', async () => {
    const result = await createEvent(
      buildEventFormData({
        event_type: 'organizer',
        watermark_enabled: 'true',
        organizer_fee_per_photo: '1.00',
      }),
    );

    const event = await readEvent(result.eventId);
    expect(event.type).toBe('organizer');
    expect(event.is_public).toBe(false); // organizer events are always private
    expect(event.watermark_enabled).toBe(true);
  });

  it('forces the watermark off on a private solo event', async () => {
    const result = await createEvent(
      buildEventFormData({ is_public: 'false', watermark_enabled: 'true' }),
    );

    const event = await readEvent(result.eventId);
    expect(event.is_public).toBe(false);
    expect(event.watermark_enabled).toBe(false);
  });
});

describe('updateEventAction — watermark rule', () => {
  it('does not strip an organizer event of its watermark on an unrelated edit', async () => {
    // The bug: before the fix this saved `false`, because the edit action
    // lacked the organizer branch and organizer events are always private. A
    // rename was enough to lose the watermark.
    const created = await createEvent(
      buildEventFormData({
        event_type: 'organizer',
        watermark_enabled: 'true',
        organizer_fee_per_photo: '1.00',
      }),
    );
    expect((await readEvent(created.eventId)).watermark_enabled).toBe(true);

    await updateEventAction(
      created.eventId,
      buildEventFormData({ name: 'Renamed Organizer Event', is_public: 'false' }),
    );

    const event = await readEvent(created.eventId);
    expect(event.name).toBe('Renamed Organizer Event');
    expect(event.watermark_enabled).toBe(true);
  });

  it('lets an organizer event turn its watermark off and on again', async () => {
    const created = await createEvent(
      buildEventFormData({
        event_type: 'organizer',
        watermark_enabled: 'true',
        organizer_fee_per_photo: '1.00',
      }),
    );

    await updateEventAction(
      created.eventId,
      buildEventFormData({ watermark_enabled: 'false', is_public: 'false' }),
    );
    expect((await readEvent(created.eventId)).watermark_enabled).toBe(false);

    await updateEventAction(
      created.eventId,
      buildEventFormData({ watermark_enabled: 'true', is_public: 'false' }),
    );
    expect((await readEvent(created.eventId)).watermark_enabled).toBe(true);
  });

  it('still forces the watermark off on a private solo event (the rule is unchanged)', async () => {
    // Guard that fixing the organizer branch did not turn into removing the
    // rule: that would change how existing events' previews are served through
    // `needsProtectedPreview`, which is far more surface than this symptom
    // justifies (option (b), rejected in the ticket).
    const created = await createEvent(buildEventFormData({ is_public: 'true' }));

    await updateEventAction(
      created.eventId,
      buildEventFormData({ is_public: 'false', watermark_enabled: 'true' }),
    );

    const event = await readEvent(created.eventId);
    expect(event.is_public).toBe(false);
    expect(event.watermark_enabled).toBe(false);
  });

  it('leaves a public event free to toggle the watermark exactly as before', async () => {
    const created = await createEvent(buildEventFormData({ is_public: 'true' }));

    await updateEventAction(created.eventId, buildEventFormData({ watermark_enabled: 'false' }));
    expect((await readEvent(created.eventId)).watermark_enabled).toBe(false);

    await updateEventAction(created.eventId, buildEventFormData({ watermark_enabled: 'true' }));
    expect((await readEvent(created.eventId)).watermark_enabled).toBe(true);
  });
});
