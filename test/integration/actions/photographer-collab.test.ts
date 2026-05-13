/**
 * Integration tests for the photographer collaboration Server Actions in
 * `app/[lang]/dashboard/photographer/events/[id]/actions.ts`.
 *
 * Covers:
 *   - inviteEventPhotographerAction      (organizer events only)
 *   - respondToEventInvitationAction     (invited photographer side)
 *   - tagPhotosForTalentAction           (photographer tags talent in photos)
 *   - untagPhotoForTalentAction
 *   - approvePendingPhotoAction          (pending → approved)
 *   - rejectPendingPhotoAction           (hard delete on rejection)
 *
 * These are mostly newer features (feature/collaborative-event branch) so the
 * tests are deliberately heavy on authorization branches.
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

import {
  approvePendingPhotoAction,
  inviteEventPhotographerAction,
  rejectPendingPhotoAction,
  respondToEventInvitationAction,
  tagPhotosForTalentAction,
  untagPhotoForTalentAction,
} from '@/app/[lang]/dashboard/photographer/events/[id]/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create an `organizer`-type event so invitations are accepted. */
async function makeOrganizerEvent(ownerId: string): Promise<{ id: string }> {
  const sb = createServiceClient();
  const suffix = crypto.randomUUID().slice(0, 8);
  const { data, error } = await sb
    .from('events')
    .insert({
      user_id: ownerId,
      name: `Organizer Event ${suffix}`,
      date: '2026-01-01',
      city: 'Barcelona',
      country: 'ES',
      state: 'Catalonia',
      activity: 'SURF',
      is_public: false,
      slug: null,
      share_code: null,
      type: 'organizer',
      is_collaborative: false,
      allow_guest_upload: false,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`makeOrganizerEvent: ${error?.message}`);
  return { id: data.id };
}

async function seedPendingInvitation(
  eventId: string,
  photographerId: string,
  invitedBy: string,
): Promise<{ invitationId: string }> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('event_photographers')
    .insert({
      event_id: eventId,
      photographer_id: photographerId,
      invited_by: invitedBy,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedPendingInvitation: ${error?.message}`);
  return { invitationId: data.id };
}

async function seedPendingPhoto(
  eventId: string,
  photographerId: string,
): Promise<{ photoId: string; storagePath: string }> {
  const sb = createServiceClient();
  const storagePath = `${photographerId}/${eventId}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: photographerId,
      event_id: eventId,
      original_url: storagePath,
      taken_at: new Date().toISOString(),
      upload_status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedPendingPhoto: ${error?.message}`);
  return { photoId: data.id, storagePath };
}

// ─── inviteEventPhotographerAction ────────────────────────────────────────────

describe('inviteEventPhotographerAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(
      inviteEventPhotographerAction(
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-0000-0000-000000000001',
      ),
    ).rejects.toThrow(/signed in/i);
  });

  it('rejects when the event is owned by another photographer', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const target = await createTestUser('PHOTOGRAPHER');
    const event = await makeOrganizerEvent(owner.id);

    mockSession.userId = attacker.id;
    await expect(inviteEventPhotographerAction(event.id, target.id)).rejects.toThrow();

    // No invitation row was created.
    const sb = createServiceClient();
    const { count } = await sb
      .from('event_photographers')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', event.id);
    expect(count).toBe(0);
  });

  it('rejects when the event is NOT type=organizer (solo/collaborative)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const target = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    mockSession.userId = owner.id;
    await expect(inviteEventPhotographerAction(event.id, target.id)).rejects.toThrow(
      /only organizer events/i,
    );
  });

  it('rejects self-invitation (caller cannot invite themselves)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await makeOrganizerEvent(owner.id);

    mockSession.userId = owner.id;
    await expect(inviteEventPhotographerAction(event.id, owner.id)).rejects.toThrow(
      /invite yourself/i,
    );
  });

  it('creates a pending invitation row when authorized', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const target = await createTestUser('PHOTOGRAPHER');
    const event = await makeOrganizerEvent(owner.id);

    mockSession.userId = owner.id;
    await inviteEventPhotographerAction(event.id, target.id);

    const sb = createServiceClient();
    const { data: row } = await sb
      .from('event_photographers')
      .select('event_id, photographer_id, invited_by, status')
      .eq('event_id', event.id)
      .eq('photographer_id', target.id)
      .single();
    expect(row?.status).toBe('pending');
    expect(row?.invited_by).toBe(owner.id);
  });
});

// ─── respondToEventInvitationAction ───────────────────────────────────────────

describe('respondToEventInvitationAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(
      respondToEventInvitationAction('00000000-0000-0000-0000-000000000000', 'accepted'),
    ).rejects.toThrow(/signed in/i);
  });

  it('rejects when caller is NOT the invited photographer', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const invited = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const event = await makeOrganizerEvent(owner.id);
    const { invitationId } = await seedPendingInvitation(event.id, invited.id, owner.id);

    mockSession.userId = attacker.id;
    await expect(respondToEventInvitationAction(invitationId, 'accepted')).rejects.toThrow(
      /not found|already responded/i,
    );

    // Invitation still pending.
    const sb = createServiceClient();
    const { data: row } = await sb
      .from('event_photographers')
      .select('status')
      .eq('id', invitationId)
      .single();
    expect(row?.status).toBe('pending');
  });

  it('flips status to accepted (and stamps responded_at) when the invited photographer accepts', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const invited = await createTestUser('PHOTOGRAPHER');
    const event = await makeOrganizerEvent(owner.id);
    const { invitationId } = await seedPendingInvitation(event.id, invited.id, owner.id);

    mockSession.userId = invited.id;
    const result = await respondToEventInvitationAction(invitationId, 'accepted');
    expect(result.status).toBe('accepted');

    const sb = createServiceClient();
    const { data: row } = await sb
      .from('event_photographers')
      .select('status, responded_at')
      .eq('id', invitationId)
      .single();
    expect(row?.status).toBe('accepted');
    expect(row?.responded_at).toBeTruthy();
  });

  it('rejects when the invitation is no longer pending (already responded)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const invited = await createTestUser('PHOTOGRAPHER');
    const event = await makeOrganizerEvent(owner.id);
    const { invitationId } = await seedPendingInvitation(event.id, invited.id, owner.id);

    // First response succeeds.
    mockSession.userId = invited.id;
    await respondToEventInvitationAction(invitationId, 'accepted');

    // Second response must fail — query filters on status='pending'.
    await expect(respondToEventInvitationAction(invitationId, 'declined')).rejects.toThrow(
      /not found|already responded/i,
    );
  });
});

// ─── tagPhotosForTalentAction ─────────────────────────────────────────────────

describe('tagPhotosForTalentAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(
      tagPhotosForTalentAction(
        ['00000000-0000-0000-0000-000000000000'],
        '00000000-0000-0000-0000-000000000001',
      ),
    ).rejects.toThrow(/signed in/i);
  });

  it("rejects when one of the photos doesn't belong to the caller (cross-photographer)", async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const talent = await createTestUser('TALENT');
    const event = await createTestEvent(owner.id);
    const photo = await createTestPhoto(event.id);

    mockSession.userId = attacker.id;
    await expect(tagPhotosForTalentAction([photo.id], talent.id)).rejects.toThrow(
      /not found|permission/i,
    );

    // No tag was created.
    const sb = createServiceClient();
    const { count } = await sb
      .from('talent_photo_tags')
      .select('*', { count: 'exact', head: true })
      .eq('photo_id', photo.id);
    expect(count).toBe(0);
  });

  it('creates tag rows when the caller owns every photo', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const talent = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id);
    const a = await createTestPhoto(event.id);
    const b = await createTestPhoto(event.id);

    mockSession.userId = photographer.id;
    const result = await tagPhotosForTalentAction([a.id, b.id], talent.id);
    expect(result.success).toBe(true);
    expect(result.taggedCount).toBe(2);

    const sb = createServiceClient();
    const { data: tags } = await sb
      .from('talent_photo_tags')
      .select('photo_id, talent_user_id, tagged_by_user_id')
      .eq('talent_user_id', talent.id);
    expect(tags).toHaveLength(2);
    for (const t of tags ?? []) {
      expect(t.tagged_by_user_id).toBe(photographer.id);
    }
  });
});

// ─── untagPhotoForTalentAction ────────────────────────────────────────────────

describe('untagPhotoForTalentAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(
      untagPhotoForTalentAction(
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-0000-0000-000000000001',
      ),
    ).rejects.toThrow(/signed in/i);
  });

  it("rejects when the photo doesn't belong to the caller", async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const talent = await createTestUser('TALENT');
    const event = await createTestEvent(owner.id);
    const photo = await createTestPhoto(event.id);
    // Seed an existing tag so the test failure isn't about "tag doesn't exist".
    const sb = createServiceClient();
    await sb.from('talent_photo_tags').insert({
      photo_id: photo.id,
      talent_user_id: talent.id,
      tagged_by_user_id: owner.id,
    });

    mockSession.userId = attacker.id;
    await expect(untagPhotoForTalentAction(photo.id, talent.id)).rejects.toThrow(
      /not found|permission/i,
    );

    // Tag survives.
    const { count } = await sb
      .from('talent_photo_tags')
      .select('*', { count: 'exact', head: true })
      .eq('photo_id', photo.id)
      .eq('talent_user_id', talent.id);
    expect(count).toBe(1);
  });

  it('removes the tag when the caller owns the photo', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const talent = await createTestUser('TALENT');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);
    const sb = createServiceClient();
    await sb.from('talent_photo_tags').insert({
      photo_id: photo.id,
      talent_user_id: talent.id,
      tagged_by_user_id: photographer.id,
    });

    mockSession.userId = photographer.id;
    await untagPhotoForTalentAction(photo.id, talent.id);

    const { count } = await sb
      .from('talent_photo_tags')
      .select('*', { count: 'exact', head: true })
      .eq('photo_id', photo.id)
      .eq('talent_user_id', talent.id);
    expect(count).toBe(0);
  });
});

// ─── approvePendingPhotoAction ────────────────────────────────────────────────

describe('approvePendingPhotoAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(
      approvePendingPhotoAction(
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-0000-0000-000000000001',
      ),
    ).rejects.toThrow(/signed in/i);
  });

  it('rejects when the event is not owned by the caller', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const { photoId } = await seedPendingPhoto(event.id, owner.id);

    mockSession.userId = attacker.id;
    await expect(approvePendingPhotoAction(photoId, event.id)).rejects.toThrow(
      /not found|access denied/i,
    );

    // Photo is still pending.
    const sb = createServiceClient();
    const { data } = await sb.from('photos').select('upload_status').eq('id', photoId).single();
    expect(data?.upload_status).toBe('pending');
  });

  it('flips upload_status from pending to approved when authorized', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const { photoId } = await seedPendingPhoto(event.id, owner.id);

    mockSession.userId = owner.id;
    await approvePendingPhotoAction(photoId, event.id);

    const sb = createServiceClient();
    const { data } = await sb.from('photos').select('upload_status').eq('id', photoId).single();
    expect(data?.upload_status).toBe('approved');
  });
});

// ─── rejectPendingPhotoAction ─────────────────────────────────────────────────

describe('rejectPendingPhotoAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(
      rejectPendingPhotoAction(
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-0000-0000-000000000001',
      ),
    ).rejects.toThrow(/signed in/i);
  });

  it('rejects when the event is not owned by the caller', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const { photoId } = await seedPendingPhoto(event.id, owner.id);

    mockSession.userId = attacker.id;
    await expect(rejectPendingPhotoAction(photoId, event.id)).rejects.toThrow(
      /not found|access denied/i,
    );

    // Photo still exists.
    const sb = createServiceClient();
    const { data } = await sb.from('photos').select('id').eq('id', photoId).maybeSingle();
    expect(data?.id).toBe(photoId);
  });

  it('hard-deletes the photo row when authorized (no undo)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const { photoId } = await seedPendingPhoto(event.id, owner.id);

    mockSession.userId = owner.id;
    await rejectPendingPhotoAction(photoId, event.id);

    const sb = createServiceClient();
    const { data } = await sb.from('photos').select('id').eq('id', photoId).maybeSingle();
    expect(data).toBeNull();
  });
});
