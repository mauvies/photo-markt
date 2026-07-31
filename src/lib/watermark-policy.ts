/**
 * Who gets to decide whether an event's photos are watermarked (T-211).
 *
 * The rule itself predates this module and is deliberate: a **private**
 * non-organizer event is already protected by its share code, so the visible
 * watermark is not applied there — `watermark_enabled` is forced to `false`
 * whatever the form sent. Organizer events are the exception, because they are
 * *always* private (access is via the membership join table, not a public URL);
 * without the carve-out every organizer event would lose its watermark, which
 * is why `createEvent` has always had it.
 *
 * What went wrong is that the rule lived in three places and only two of them
 * agreed:
 *
 *  - `createEvent` applied it **with** the organizer exception;
 *  - `updateEventAction` applied it **without** — so a private organizer event
 *    created with a watermark lost it the first time any edit was saved, even
 *    an edit that never touched the field;
 *  - the edit form did not apply it at all: the switch rendered enabled on a
 *    private event, the photographer turned it on, the save reported success,
 *    and the server wrote `false`. The only client-side trace of the rule was
 *    the `is_public` toggle pushing `watermark_enabled` alongside it — which
 *    never runs on an event that was already private when the form opened.
 *
 * So the rule is one function now, called by both actions and by both forms.
 * The server stays the authority (a hand-crafted POST is still normalized here);
 * the disabled switch is UX, not the guarantee.
 */

export interface WatermarkPolicyInput {
  /** `events.type` — `solo` | `collaborative` | `organizer` (or null on legacy rows). */
  eventType: string | null | undefined;
  /** The event's visibility as it will be persisted, after any other forcing. */
  isPublic: boolean;
}

/**
 * Whether the photographer's watermark choice is honoured for this event.
 *
 * `false` means the stored value will be `false` no matter what was submitted —
 * which is precisely when a form must show the switch off and disabled rather
 * than offering a preference the save will silently discard.
 */
export function isWatermarkConfigurable({ eventType, isPublic }: WatermarkPolicyInput): boolean {
  return eventType === 'organizer' || isPublic;
}

/** The value that will actually be persisted for the requested setting. */
export function resolveWatermarkEnabled(
  input: WatermarkPolicyInput & { requested: boolean },
): boolean {
  return isWatermarkConfigurable(input) ? input.requested : false;
}
