/**
 * Integration tests for the photographer event Server Actions:
 *   - createEvent           (events/new/actions.ts)
 *   - updateEventAction     (events/[id]/edit/actions.ts)
 *   - deletePhotoAction     (events/[id]/edit/actions.ts)
 *   - addPhotosAction       (events/[id]/edit/actions.ts)
 *   - deleteEventAction     (events/actions.ts)
 *
 * These are the core revenue-path mutations. The tests pin:
 *   - Auth gates (no auth → throw)
 *   - Ownership (photographer A cannot touch photographer B's events/photos)
 *   - Zod boundary (missing/invalid fields rejected before DB call)
 *   - Soft-delete semantics on events (`deleted_at` set, row preserved)
 *   - Hard-delete semantics on photos (row removed)
 *   - validatePhotoUpload integration (non-image bytes rejected)
 */

import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

// Inline vi.mock declarations — Vitest only hoists them when they appear at
// the top level of the test file.

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
  addPhotosAction,
  deletePhotoAction,
  updateEventAction,
} from '@/app/[lang]/dashboard/photographer/events/[id]/edit/actions';
import { deleteEventAction } from '@/app/[lang]/dashboard/photographer/events/actions';
import { createEvent } from '@/app/[lang]/dashboard/photographer/events/new/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a 4x4 JPEG that passes `validatePhotoUpload`'s magic-byte check.
 * Sharp encodes a real JPEG so the file is a true image, not a fake MIME header.
 */
async function makeJpegFile(name = 'photo.jpg'): Promise<File> {
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#112233' },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(buf)], name, { type: 'image/jpeg' });
}

/** Build a FormData payload for `createEvent` / `updateEventAction`. */
function buildEventFormData(overrides: Record<string, string> = {}, photos: File[] = []): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    name: 'Test Event',
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
    price_per_photo: '',
  };
  const merged: Record<string, string> = { ...defaults, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    fd.append(k, v);
  }
  for (const file of photos) fd.append('photos', file);
  return fd;
}

// ─── createEvent ──────────────────────────────────────────────────────────────

describe('createEvent', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    const fd = buildEventFormData({}, [await makeJpegFile()]);
    await expect(createEvent(fd)).rejects.toThrow(/signed in/i);
  });

  it('rejects when required fields are missing (Zod boundary)', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    // Empty name should fail Zod.
    const fd = buildEventFormData({ name: '' }, [await makeJpegFile()]);
    await expect(createEvent(fd)).rejects.toThrow(/name is required/i);
  });

  it('rejects when activity is not in the enum', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const fd = buildEventFormData({ activity: 'NOT_A_REAL_ACTIVITY' }, [await makeJpegFile()]);
    await expect(createEvent(fd)).rejects.toThrow(/activity is required/i);
  });

  it('requires at least one photo for SOLO events', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const fd = buildEventFormData({ event_type: 'solo' });
    await expect(createEvent(fd)).rejects.toThrow(/at least one photo/i);
  });

  it('creates a public solo event with a SEO slug and no share_code', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;

    const result = await createEvent(
      buildEventFormData({ event_type: 'solo', is_public: 'true' }, [await makeJpegFile()]),
    );
    expect(result.eventId).toBeTruthy();
    expect(result.shareCode).toBeNull();

    const sb = createServiceClient();
    const { data: event } = await sb
      .from('events')
      .select('user_id, slug, share_code, is_public, type, is_collaborative')
      .eq('id', result.eventId)
      .single();
    expect(event?.user_id).toBe(user.id);
    expect(event?.is_public).toBe(true);
    expect(event?.type).toBe('solo');
    expect(event?.share_code).toBeNull();
    expect(event?.slug).toBeTruthy();
  });

  it('creates a PRIVATE solo event with a share_code (no slug)', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;

    const result = await createEvent(
      buildEventFormData({ event_type: 'solo', is_public: 'false' }, [await makeJpegFile()]),
    );
    expect(result.shareCode).toMatch(/^[A-Z0-9]{8}$/);

    const sb = createServiceClient();
    const { data: event } = await sb
      .from('events')
      .select('is_public, share_code, slug, watermark_enabled')
      .eq('id', result.eventId)
      .single();
    expect(event?.is_public).toBe(false);
    expect(event?.share_code).toBe(result.shareCode);
    // Watermark only applies to public events.
    expect(event?.watermark_enabled).toBe(false);
  });

  it('creates a COLLABORATIVE event without requiring upfront photos', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;

    const result = await createEvent(
      buildEventFormData({ event_type: 'collaborative', is_public: 'true' }),
    );
    expect(result.eventId).toBeTruthy();
    expect(result.shareCode).toMatch(/^[A-Z0-9]{8}$/);

    const sb = createServiceClient();
    const { data: event } = await sb
      .from('events')
      .select('type, is_collaborative, share_code, is_public')
      .eq('id', result.eventId)
      .single();
    expect(event?.type).toBe('collaborative');
    expect(event?.is_collaborative).toBe(true);
    // Collaborative events always need a share code, even when public.
    expect(event?.share_code).toBeTruthy();
  });

  it('uploads each photo with user_id set to the caller', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;

    const result = await createEvent(
      buildEventFormData({}, [await makeJpegFile('a.jpg'), await makeJpegFile('b.jpg')]),
    );

    const sb = createServiceClient();
    const { data: photos } = await sb
      .from('photos')
      .select('user_id, event_id, original_url')
      .eq('event_id', result.eventId);
    expect(photos).toHaveLength(2);
    for (const p of photos ?? []) {
      expect(p.user_id).toBe(user.id);
      // Storage path convention: <userId>/<eventId>/<uuid>.<ext>
      expect(p.original_url).toMatch(new RegExp(`^${user.id}/${result.eventId}/`));
    }
  });
});

// ─── updateEventAction ────────────────────────────────────────────────────────

describe('updateEventAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(
      updateEventAction('00000000-0000-0000-0000-000000000000', new FormData()),
    ).rejects.toThrow(/signed in/i);
  });

  it('rejects when the event belongs to another photographer (ownership)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { is_public: true });

    mockSession.userId = attacker.id;
    // The underlying `getEvent(supabase, eventId, attackerId)` filters by
    // user_id, so the attacker sees no event and the action throws.
    await expect(updateEventAction(event.id, buildEventFormData())).rejects.toThrow();
  });

  it('persists changed fields when the caller owns the event', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const event = await createTestEvent(user.id, { name: 'Old Name', city: 'Madrid' });

    await updateEventAction(
      event.id,
      buildEventFormData({ name: 'New Name', city: 'Tarragona', price_per_photo: '12.50' }),
    );

    const sb = createServiceClient();
    const { data: row } = await sb
      .from('events')
      .select('name, city, price_per_photo')
      .eq('id', event.id)
      .single();
    expect(row?.name).toBe('New Name');
    expect(row?.city).toBe('Tarragona');
    expect(Number(row?.price_per_photo)).toBe(12.5);
  });

  it('disables watermark when toggling event to private (watermark is public-only)', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const event = await createTestEvent(user.id, { is_public: true });
    // Sanity: existing event has watermark off by default (createTestEvent
    // doesn't override). Force it on first so the toggle has something to flip.
    const sb = createServiceClient();
    await sb.from('events').update({ watermark_enabled: true }).eq('id', event.id);

    await updateEventAction(
      event.id,
      buildEventFormData({ is_public: 'false', watermark_enabled: 'true' }),
    );

    const { data: row } = await sb
      .from('events')
      .select('is_public, watermark_enabled, share_code')
      .eq('id', event.id)
      .single();
    expect(row?.is_public).toBe(false);
    expect(row?.watermark_enabled).toBe(false);
    // Private events always get a share_code (generated if missing).
    expect(row?.share_code).toBeTruthy();
  });
});

// ─── deletePhotoAction ────────────────────────────────────────────────────────

describe('deletePhotoAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(
      deletePhotoAction(
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-0000-0000-000000000000',
      ),
    ).rejects.toThrow(/signed in/i);
  });

  it('rejects when the event is not owned by the caller (cross-photographer)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photo = await createTestPhoto(event.id);

    mockSession.userId = attacker.id;
    await expect(deletePhotoAction(photo.id, event.id)).rejects.toThrow(
      /event not found|access denied/i,
    );

    // Photo still exists.
    const sb = createServiceClient();
    const { data } = await sb.from('photos').select('id').eq('id', photo.id).maybeSingle();
    expect(data).toBeTruthy();
  });

  it('hard-deletes the photo row when the caller owns the event', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const event = await createTestEvent(user.id);
    const photo = await createTestPhoto(event.id);

    await deletePhotoAction(photo.id, event.id);

    const sb = createServiceClient();
    const { data } = await sb.from('photos').select('id').eq('id', photo.id).maybeSingle();
    expect(data).toBeNull();
  });
});

// ─── addPhotosAction ──────────────────────────────────────────────────────────

describe('addPhotosAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    const fd = new FormData();
    fd.append('photos', await makeJpegFile());
    await expect(addPhotosAction('00000000-0000-0000-0000-000000000000', fd)).rejects.toThrow(
      /signed in/i,
    );
  });

  it('rejects when the event is owned by another photographer', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    mockSession.userId = attacker.id;
    const fd = new FormData();
    fd.append('photos', await makeJpegFile());
    // `getEvent` is implemented with `.single().throwOnError()`, so the
    // ownership-failure path throws PostgREST's "Cannot coerce" error rather
    // than the `if (!event)` branch's user-facing message. Asserting on the
    // PostgREST shape pins the current behavior; a future fix in
    // `database/queries/events.ts:getEvent` to return null on 0 rows should
    // flip this assertion to `/not found|access denied/i`.
    await expect(addPhotosAction(event.id, fd)).rejects.toThrow(
      /not found|access denied|cannot coerce/i,
    );

    // The security guarantee — no photo created for the attacker — holds
    // regardless of which error message wins.
    const sb = createServiceClient();
    const { count } = await sb
      .from('photos')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', event.id);
    expect(count).toBe(0);
  });

  it('rejects an empty FormData (no photos provided)', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const event = await createTestEvent(user.id);

    await expect(addPhotosAction(event.id, new FormData())).rejects.toThrow(/no photos/i);
  });

  it('uploads provided photos and creates the corresponding rows', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const event = await createTestEvent(user.id);

    const fd = new FormData();
    fd.append('photos', await makeJpegFile('a.jpg'));
    fd.append('photos', await makeJpegFile('b.jpg'));
    await addPhotosAction(event.id, fd);

    const sb = createServiceClient();
    const { data: photos } = await sb
      .from('photos')
      .select('id, user_id, event_id')
      .eq('event_id', event.id);
    expect(photos).toHaveLength(2);
    for (const p of photos ?? []) expect(p.user_id).toBe(user.id);
  });

  it('rejects when a file fails validatePhotoUpload (not a real image)', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const event = await createTestEvent(user.id);

    // SVG bytes with image/jpeg MIME — must be rejected by the magic-byte
    // check inside `validatePhotoUpload`.
    const evil = new File(
      [new Uint8Array(Buffer.from('<svg onload="alert(1)"></svg>', 'utf8'))],
      'evil.jpg',
      { type: 'image/jpeg' },
    );
    const fd = new FormData();
    fd.append('photos', evil);

    await expect(addPhotosAction(event.id, fd)).rejects.toThrow(/not a valid image|Unsupported/);
  });
});

// ─── deleteEventAction ────────────────────────────────────────────────────────

describe('deleteEventAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  it('rejects without an eventId', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    await expect(deleteEventAction('')).rejects.toThrow(/event id is required/i);
  });

  it('rejects unauthenticated callers', async () => {
    mockSession.userId = null;
    await expect(deleteEventAction('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      /signed in/i,
    );
  });

  it('rejects when the event belongs to another photographer', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const attacker = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    mockSession.userId = attacker.id;
    await expect(deleteEventAction(event.id)).rejects.toThrow();

    // Event is NOT soft-deleted.
    const sb = createServiceClient();
    const { data: row } = await sb
      .from('events')
      .select('id, deleted_at')
      .eq('id', event.id)
      .single();
    expect(row?.deleted_at).toBeNull();
  });

  it('soft-deletes the event (deleted_at set, row preserved)', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const event = await createTestEvent(user.id);

    await deleteEventAction(event.id);

    const sb = createServiceClient();
    const { data: row } = await sb
      .from('events')
      .select('id, deleted_at')
      .eq('id', event.id)
      .single();
    // Row preserved for historical metrics.
    expect(row?.id).toBe(event.id);
    expect(row?.deleted_at).toBeTruthy();
  });

  it('hard-deletes the event photos as a side effect (not soft delete)', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    mockSession.userId = user.id;
    const event = await createTestEvent(user.id);
    const photo = await createTestPhoto(event.id);

    await deleteEventAction(event.id);

    const sb = createServiceClient();
    const { data: leftover } = await sb
      .from('photos')
      .select('id')
      .eq('id', photo.id)
      .maybeSingle();
    expect(leftover).toBeNull();
  });
});
