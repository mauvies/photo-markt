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

  it('drops a ladder on a free event instead of failing the create', async () => {
    // A free event has nothing to discount, so a ladder is normalized away rather
    // than rejected — the same treatment `watermark_enabled` and
    // `reveal_gate_enabled` get when their preconditions fail. Rejecting instead
    // made pricing state able to block saves that were not about pricing.
    const result = await createEvent(
      buildEventFormData({ price_per_photo: '', bundle_tiers: JSON.stringify(LADDER) }),
    );
    expect(result.eventId).toBeTruthy();
    expect(await readTiers(result.eventId)).toBeNull();
  });

  it('drops a ladder on an organizer event rather than storing one', async () => {
    // Organizer events can span several sellers and have no revenue split to
    // charge a discount against, so they may never carry a ladder.
    const result = await createEvent(
      buildEventFormData({
        event_type: 'organizer',
        bundle_tiers: JSON.stringify(LADDER),
      }),
    );
    expect(result.eventId).toBeTruthy();
    expect(await readTiers(result.eventId)).toBeNull();
  });

  it('REJECTS a malformed payload rather than creating the event without a ladder', async () => {
    // Expectation flipped in T-212. This used to assert that garbage parsed to
    // "no ladder" — reasoning that pricing at quantity × unit can only overcharge
    // relative to intent. That reasoning holds for a READ of stored data; on a
    // WRITE it means the photographer's input is discarded and the save reports
    // success, which is the data-loss bug this ticket fixes. A write that cannot
    // be understood must say so.
    await expect(
      createEvent(buildEventFormData({ bundle_tiers: 'not json at all' })),
    ).rejects.toThrow(/BUNDLE_TIERS:not_parseable/);
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

  it('KEEPS the ladder when the event is made free, and still saves', async () => {
    // Expectation flipped in T-212. T-203 fixed a real 500 here (a scoped form
    // echoing a ladder with a cleared price threw `total_not_a_discount`) but
    // fixed it by DELETING the ladder. The save-must-not-be-blocked half was
    // right; the deletion half was the same silent data loss in a new place.
    // A free event simply cannot apply its ladder — nothing has to be destroyed
    // for that to be true, and restoring a price restores the packs.
    const event = await createTestEvent(userId, { price_per_photo: 5 });
    await updateEventAction(event.id, buildEventFormData({ bundle_tiers: JSON.stringify(LADDER) }));
    expect(await readTiers(event.id)).toEqual(LADDER);

    await updateEventAction(
      event.id,
      buildEventFormData({ price_per_photo: '', bundle_tiers: JSON.stringify(LADDER) }),
    );

    expect(await readTiers(event.id)).toEqual(LADDER);
    const sb = createServiceClient();
    const { data } = await sb.from('events').select('price_per_photo').eq('id', event.id).single();
    expect(data?.price_per_photo).toBeNull();
  });

  it('saves an unrelated section on a free event that still holds a stored ladder', async () => {
    // The exact reported shape: a stored ladder + no price + an edit that has
    // nothing to do with pricing. Must succeed, not 500.
    const event = await createTestEvent(userId, { price_per_photo: 5 });
    const sb = createServiceClient();
    await sb
      .from('events')
      .update({ bundle_tiers: LADDER, price_per_photo: null })
      .eq('id', event.id);

    await expect(
      updateEventAction(
        event.id,
        buildEventFormData({
          name: 'Renamed While Free',
          price_per_photo: '',
          bundle_tiers: JSON.stringify(LADDER),
        }),
      ),
    ).resolves.toMatchObject({ success: true });

    const { data } = await sb.from('events').select('name').eq('id', event.id).single();
    expect(data?.name).toBe('Renamed While Free');
    // T-212: the unrelated save succeeds AND leaves the pricing intact.
    expect(await readTiers(event.id)).toEqual(LADDER);
  });

  it('persists an "all photos" flat price with no rungs at all', async () => {
    // The owner's ask: "EUR 5 a photo, or EUR 20 for all of them" — no packs.
    const event = await createTestEvent(userId, { price_per_photo: 5 });
    await updateEventAction(event.id, buildEventFormData({ bundle_all_photos_cents: '2000' }));

    const sb = createServiceClient();
    const { data } = await sb
      .from('events')
      .select('bundle_all_photos_cents')
      .eq('id', event.id)
      .single();
    expect((data as { bundle_all_photos_cents?: number | null })?.bundle_all_photos_cents).toBe(
      2000,
    );

    // And it prices as a ceiling: per photo below it, flat above.
    expect(getBundlePriceCents(3, 500, null, 2000)).toBe(1500);
    expect(getBundlePriceCents(40, 500, null, 2000)).toBe(2000);
  });

  it('rejects an "all photos" price at or below the single-photo price', async () => {
    const event = await createTestEvent(userId, { price_per_photo: 5 });
    await expect(
      updateEventAction(event.id, buildEventFormData({ bundle_all_photos_cents: '500' })),
    ).rejects.toThrow(/BUNDLE_TIERS:all_photos_not_above_unit/);
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

/**
 * T-212 — the write path must never delete a stored ladder as a side effect.
 *
 * Every case below ends with the ladder still in the row. Before this ticket
 * each of them wiped it and reported success, because "could not parse", "the
 * photographer cleared it" and "this form didn't mention it" were all the same
 * `null`.
 */
describe('updateEventAction — the ladder survives edits that are not about it', () => {
  async function seedLadder(price = 5) {
    const event = await createTestEvent(userId, { price_per_photo: price });
    await updateEventAction(event.id, buildEventFormData({ bundle_tiers: JSON.stringify(LADDER) }));
    expect(await readTiers(event.id)).toEqual(LADDER);
    return event;
  }

  it('an edit that OMITS the field leaves the ladder alone', async () => {
    // What a section with no ladder editor now sends: nothing at all.
    const event = await seedLadder();
    const fd = buildEventFormData({ name: 'Renamed' });
    expect(fd.has('bundle_tiers')).toBe(false);

    await updateEventAction(event.id, fd);

    expect(await readTiers(event.id)).toEqual(LADDER);
  });

  it('LOWERING the price from a form without the editor is not blocked', async () => {
    // The stored rung (3 → €12) stops being a discount at €3/photo. That used
    // to throw `total_not_a_discount` from a section that cannot show the
    // ladder, so the price change was simply impossible there.
    const event = await seedLadder();

    await updateEventAction(event.id, buildEventFormData({ price_per_photo: '3.00' }));

    const sb = createServiceClient();
    const { data } = await sb.from('events').select('price_per_photo').eq('id', event.id).single();
    expect(Number(data?.price_per_photo)).toBe(3);
    // And the ladder is still there — a now-dead rung is harmless, because the
    // kernel's `min` guard just stops applying it.
    expect(await readTiers(event.id)).toEqual(LADDER);
  });

  it('a rung with a cleared total is REJECTED, not silently turned into "no ladder"', async () => {
    const event = await seedLadder();

    await expect(
      updateEventAction(
        event.id,
        buildEventFormData({
          bundle_tiers: JSON.stringify([{ minQuantity: 3, totalPriceCents: 0 }]),
        }),
      ),
    ).rejects.toThrow(/BUNDLE_TIERS:/);

    expect(await readTiers(event.id)).toEqual(LADDER);
  });

  it('a threshold of 1 is REJECTED by name rather than deleting the ladder', async () => {
    const event = await seedLadder();

    await expect(
      updateEventAction(
        event.id,
        buildEventFormData({
          bundle_tiers: JSON.stringify([{ minQuantity: 1, totalPriceCents: 900 }]),
        }),
      ),
    ).rejects.toThrow(/quantity_too_low/);

    expect(await readTiers(event.id)).toEqual(LADDER);
  });

  it('unparseable JSON is REJECTED rather than read as an empty ladder', async () => {
    const event = await seedLadder();

    await expect(
      updateEventAction(event.id, buildEventFormData({ bundle_tiers: 'not-json' })),
    ).rejects.toThrow(/BUNDLE_TIERS:/);

    expect(await readTiers(event.id)).toEqual(LADDER);
  });

  it('clearing the PRICE keeps the ladder stored instead of dropping it', async () => {
    // The ladder cannot apply while the event is free, but deleting the
    // photographer's configuration as a side effect of making an event free is
    // data loss — restoring a price restores the packs.
    const event = await seedLadder();

    await updateEventAction(event.id, buildEventFormData({ price_per_photo: '0' }));

    expect(await readTiers(event.id)).toEqual(LADDER);
  });

  it('an explicit empty value still clears it — the one case that should', async () => {
    const event = await seedLadder();

    await updateEventAction(event.id, buildEventFormData({ bundle_tiers: '' }));

    expect(await readTiers(event.id)).toBeNull();
  });
});
