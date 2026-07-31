import { describe, expect, it } from 'vitest';
import { isWatermarkConfigurable, resolveWatermarkEnabled } from '@/lib/watermark-policy';

/**
 * T-211 — one rule for "is this event watermarked", shared by both event
 * actions and both forms.
 *
 * The rule is unchanged (a private non-organizer event is protected by its
 * share code, so no visible watermark); what changed is that it now exists
 * once. It had drifted into three copies, two of which disagreed: the edit
 * action had lost the organizer branch, and the edit form had no copy at all,
 * so it offered a switch whose value the save discarded.
 */

const TYPES = ['solo', 'collaborative', 'organizer', null, undefined] as const;

describe('isWatermarkConfigurable', () => {
  it('honours the choice on any public event', () => {
    for (const eventType of TYPES) {
      expect(isWatermarkConfigurable({ eventType, isPublic: true })).toBe(true);
    }
  });

  it('overrides the choice on a private non-organizer event', () => {
    for (const eventType of ['solo', 'collaborative', null, undefined] as const) {
      expect(isWatermarkConfigurable({ eventType, isPublic: false })).toBe(false);
    }
  });

  it('exempts organizer events, which are private by construction', () => {
    // Organizer events have no public URL at all — access is the membership
    // join table. Without this branch every organizer event would be stripped
    // of its watermark, which is exactly what the edit action was doing.
    expect(isWatermarkConfigurable({ eventType: 'organizer', isPublic: false })).toBe(true);
  });
});

describe('resolveWatermarkEnabled', () => {
  it('returns what was requested wherever the choice is honoured', () => {
    for (const requested of [true, false]) {
      expect(resolveWatermarkEnabled({ eventType: 'solo', isPublic: true, requested })).toBe(
        requested,
      );
      expect(resolveWatermarkEnabled({ eventType: 'organizer', isPublic: false, requested })).toBe(
        requested,
      );
    }
  });

  it('forces off on a private non-organizer event, whatever was submitted', () => {
    // The server stays the authority: a hand-crafted POST with
    // watermark_enabled=true is still normalized to false here.
    expect(resolveWatermarkEnabled({ eventType: 'solo', isPublic: false, requested: true })).toBe(
      false,
    );
    expect(
      resolveWatermarkEnabled({ eventType: 'collaborative', isPublic: false, requested: true }),
    ).toBe(false);
  });

  it('agrees with the predicate the forms disable the switch on', () => {
    // The property that makes displayed == persisted: whenever the switch is
    // rendered disabled, the resolved value is false regardless of state.
    for (const eventType of TYPES) {
      for (const isPublic of [true, false]) {
        const configurable = isWatermarkConfigurable({ eventType, isPublic });
        if (!configurable) {
          expect(resolveWatermarkEnabled({ eventType, isPublic, requested: true })).toBe(false);
        }
      }
    }
  });
});
