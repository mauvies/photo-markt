/**
 * Integration tests for the volume-pricing ladder (T-200 design, T-203).
 *
 * The ladder's rules are enforced at WRITE time in both event Server Actions,
 * not as a DB constraint — so an event configured under an older rule keeps
 * selling until its ladder is next written. These pin that behaviour end to end
 * against the real schema and the real shipped price floor.
 *
 * The rule with the most at stake is "totals must strictly increase with
 * threshold": without it a ladder silently collapses to its cheapest rung, and
 * a 20-photo buyer pays the 3-photo price. That one gets a dedicated case in
 * both actions.
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
import { getBundlePriceCents, parseBundleTiers } from '@/lib/bundle-pricing';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** The owner's own example: unit €5 · 3+ for €12 · 8+ for €20. */
const LADDER = [
  { minQuantity: 3, totalPriceCents: 1200 },
  { minQuantity: 8, totalPriceCents: 2000 },
];

function buildEventFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    name: 'Bundled Event',
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

async function readTiers(eventId: string) {
  const sb = createServiceClient();
  const { data } = await sb.from('events').select('bundle_tiers').eq('id', eventId).single();
  return parseBundleTiers((data as { bundle_tiers?: unknown } | null)?.bundle_tiers);
}

let userId: string;

beforeEach(async () => {
  await resetDatabase();
  await ensurePhotosBucket();
  const user = await createTestUser('PHOTOGRAPHER');
  userId = user.id;
  mockSession.userId = user.id;
  mockSession.activeRole = 'photographer';
});

describe('createEvent — bundle ladder', () => {
  it('persists a valid ladder', async () => {
    const result = await createEvent(buildEventFormData({ bundle_tiers: JSON.stringify(LADDER) }));
    expect(result.eventId).toBeTruthy();
    expect(await readTiers(result.eventId)).toEqual(LADDER);
  });

  it('stores no ladder when the field is absent or empty', async () => {
    const result = await createEvent(buildEventFormData({ bundle_tiers: '' }));
    expect(await readTiers(result.eventId)).toBeNull();
  });

  it('rejects a ladder whose totals do not increase, without creating the event', async () => {
    // The collapse case. 8+ at €10 is cheaper than 3+ at €12, so every quantity
    // from 3 up would be priced at €10 — not what the photographer described.
    const collapsing = [
      { minQuantity: 3, totalPriceCents: 1200 },
      { minQuantity: 8, totalPriceCents: 1000 },
    ];
    await expect(
      createEvent(buildEventFormData({ bundle_tiers: JSON.stringify(collapsing) })),
    ).rejects.toThrow(/BUNDLE_TIERS:total_not_increasing/);

    const sb = createServiceClient();
    const { data } = await sb.from('events').select('id').eq('user_id', userId);
    expect(data ?? []).toHaveLength(0);
  });

  it('rejects a rung that is not a discount', async () => {
    // 3 × €5 = €15, so a €15 "pack" would never apply.
    await expect(
      createEvent(
        buildEventFormData({
          bundle_tiers: JSON.stringify([{ minQuantity: 3, totalPriceCents: 1500 }]),
        }),
      ),
    ).rejects.toThrow(/BUNDLE_TIERS:total_not_a_discount/);
  });

  it('rejects a rung total below the shipped price floor', async () => {
    // €1.00 total is under the €1.50 floor. The floor applies to the rung TOTAL,
    // not per photo — a big cheap-per-photo bundle is fine, a trivially cheap
    // total is not.
    await expect(
      createEvent(
        buildEventFormData({
          price_per_photo: '5.00',
          bundle_tiers: JSON.stringify([{ minQuantity: 3, totalPriceCents: 100 }]),
        }),
      ),
    ).rejects.toThrow(/BUNDLE_TIERS:total_below_floor:150/);
  });

  it('accepts a large pack whose per-photo price is far below the floor', async () => {
    // 40 photos for €19.90 is €0.50/photo — well under the €1.50 floor per
    // photo, but the total is what the floor governs, so this is allowed.
    const result = await createEvent(
      buildEventFormData({
        bundle_tiers: JSON.stringify([{ minQuantity: 40, totalPriceCents: 1990 }]),
      }),
    );
    expect(await readTiers(result.eventId)).toEqual([{ minQuantity: 40, totalPriceCents: 1990 }]);
  });

  it('rejects a ladder on a free event', async () => {
    await expect(
      createEvent(
        buildEventFormData({ price_per_photo: '', bundle_tiers: JSON.stringify(LADDER) }),
      ),
    ).rejects.toThrow(/BUNDLE_TIERS:/);
  });

  it('drops a ladder on an organizer event rather than storing one', async () => {
    // Organizer events can span several sellers and have no revenue split to
    // charge a discount against, so they may never carry a ladder.
    await expect(
      createEvent(
        buildEventFormData({
          event_type: 'organizer',
          organizer_fee_per_photo: '1.00',
          bundle_tiers: JSON.stringify(LADDER),
        }),
      ),
    ).rejects.toThrow(/BUNDLE_TIERS:/);
  });

  it('fails closed to no ladder on a malformed payload instead of erroring', async () => {
    // A garbage payload parses to "no ladder", which prices at quantity × unit —
    // a direction that can only overcharge relative to intent, never undercharge.
    const result = await createEvent(buildEventFormData({ bundle_tiers: 'not json at all' }));
    expect(await readTiers(result.eventId)).toBeNull();
  });
});

describe('updateEventAction — bundle ladder', () => {
  it('adds a ladder to an existing priced event', async () => {
    const event = await createTestEvent(userId, { price_per_photo: 5 });

    await updateEventAction(event.id, buildEventFormData({ bundle_tiers: JSON.stringify(LADDER) }));
    expect(await readTiers(event.id)).toEqual(LADDER);
  });

  it('clears a ladder when an empty field is submitted', async () => {
    const event = await createTestEvent(userId, { price_per_photo: 5 });
    await updateEventAction(event.id, buildEventFormData({ bundle_tiers: JSON.stringify(LADDER) }));
    expect(await readTiers(event.id)).toEqual(LADDER);

    await updateEventAction(event.id, buildEventFormData({ bundle_tiers: '' }));
    expect(await readTiers(event.id)).toBeNull();
  });

  it('leaves a stored ladder untouched when the edit re-submits it unchanged', async () => {
    // This is the data-loss guard: a section-scoped form edits (say) the event
    // name but still echoes the whole payload, so the ladder must survive.
    const event = await createTestEvent(userId, { price_per_photo: 5 });
    await updateEventAction(event.id, buildEventFormData({ bundle_tiers: JSON.stringify(LADDER) }));

    await updateEventAction(
      event.id,
      buildEventFormData({ name: 'Renamed Event', bundle_tiers: JSON.stringify(LADDER) }),
    );

    expect(await readTiers(event.id)).toEqual(LADDER);
    const sb = createServiceClient();
    const { data } = await sb.from('events').select('name').eq('id', event.id).single();
    expect(data?.name).toBe('Renamed Event');
  });

  it('rejects a collapsing ladder and leaves the stored one intact', async () => {
    const event = await createTestEvent(userId, { price_per_photo: 5 });
    await updateEventAction(event.id, buildEventFormData({ bundle_tiers: JSON.stringify(LADDER) }));

    const collapsing = [
      { minQuantity: 3, totalPriceCents: 1200 },
      { minQuantity: 8, totalPriceCents: 1000 },
    ];
    await expect(
      updateEventAction(event.id, buildEventFormData({ bundle_tiers: JSON.stringify(collapsing) })),
    ).rejects.toThrow(/BUNDLE_TIERS:total_not_increasing/);

    expect(await readTiers(event.id)).toEqual(LADDER);
  });

  it('rejects a ladder when the event is being made free', async () => {
    const event = await createTestEvent(userId, { price_per_photo: 5 });

    await expect(
      updateEventAction(
        event.id,
        buildEventFormData({ price_per_photo: '', bundle_tiers: JSON.stringify(LADDER) }),
      ),
    ).rejects.toThrow(/BUNDLE_TIERS:/);
  });

  it('leaves an existing sub-rule ladder alone until its own write (write-time enforcement)', async () => {
    // Seeded directly, bypassing the action — the shape a row could have if the
    // rules were tightened after it was written. Reads must keep working.
    const event = await createTestEvent(userId, { price_per_photo: 5 });
    const sb = createServiceClient();
    await sb
      .from('events')
      .update({ bundle_tiers: [{ minQuantity: 3, totalPriceCents: 1200 }] })
      .eq('id', event.id);

    // An unrelated edit that echoes the stored ladder does not reject it.
    await updateEventAction(
      event.id,
      buildEventFormData({
        name: 'Still Selling',
        bundle_tiers: JSON.stringify([{ minQuantity: 3, totalPriceCents: 1200 }]),
      }),
    );
    expect(await readTiers(event.id)).toEqual([{ minQuantity: 3, totalPriceCents: 1200 }]);
  });
});

describe('stored ladders price correctly end to end', () => {
  it('prices each rung of a persisted ladder', async () => {
    const result = await createEvent(buildEventFormData({ bundle_tiers: JSON.stringify(LADDER) }));
    const tiers = await readTiers(result.eventId);
    const unit = 500;

    // The whole point of the feature, read back from the database: each rung is
    // reachable and the 8+ rung is not shadowed by the cheaper 3+ rung.
    expect(getBundlePriceCents(1, unit, tiers)).toBe(500);
    expect(getBundlePriceCents(3, unit, tiers)).toBe(1200);
    expect(getBundlePriceCents(7, unit, tiers)).toBe(1200);
    expect(getBundlePriceCents(8, unit, tiers)).toBe(2000);
    expect(getBundlePriceCents(20, unit, tiers)).toBe(2000);
  });
});
