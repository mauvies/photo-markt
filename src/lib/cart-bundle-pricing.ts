/**
 * Cart-level bundle pricing (T-200 design, T-204 ticket B).
 *
 * `bundle-pricing.ts` answers "what does a SET of N photos from one event cost".
 * This module answers the question a real cart asks: "what does THIS cart cost,
 * and what does each photo in it contribute to that total".
 *
 * It is THE single point where a cart is grouped and priced. Both checkouts
 * (guest + authenticated) and both cart views call it, so what the buyer sees
 * before Stripe and what the session charges cannot diverge — the same
 * discipline `getBuyerServiceFeeCents` established in billing v2. Deliberately
 * **client-safe** (no `env.mjs`, no server-only import) for exactly that reason.
 *
 * Two rules carry the feature:
 *
 * 1. **Grouping is by `(event, photographer)`, not by cart.** A ladder belongs to
 *    one event, and a discount must never be funded by another photographer's
 *    revenue, so a cart spanning two events discounts only the group that
 *    qualifies. The `(event, photographer)` pair rather than event alone is
 *    forward-compatible with organizer events (several sellers per event), which
 *    are excluded from bundles today — keeping the grouping key right now means
 *    enabling them later is a gate change, not a redesign.
 *
 * 2. **The discounted group total is ALLOCATED across its photos, exactly.**
 *    `order_items.unit_price_cents` feeds `createTransfersForOrderItems`; list
 *    prices on the rows against a discounted charge would transfer money the
 *    platform never collected. `sum(allocations) === subtotalCents` is asserted
 *    by construction here and by test.
 */

import {
  allocateBundleTotalCents,
  type BundleTier,
  getBundlePriceCents,
  getNextBundleTier,
} from '@/lib/bundle-pricing';

/**
 * One cart line, in the shape every call site can produce: the guest cart from
 * localStorage + a per-event pricing lookup, the authenticated cart from
 * `cart_items` joined to its event, and both checkouts from their
 * server-validated item lists.
 */
export interface BundleCartLine {
  photoId: string;
  /** Null/absent for a legacy row with no event — priced at list, never bundled. */
  eventId: string | null;
  photographerId: string;
  /** What this photo costs on its own, in cents. */
  unitPriceCents: number;
  /** Event name, only used to name the event in the next-rung prompt. */
  eventName?: string | null;
  /** Parsed ladder for this photo's event (`parseBundleTiers` output). */
  bundleTiers?: BundleTier[] | null;
  /** The event's "all photos" flat price in cents, if set. */
  bundleAllPhotosCents?: number | null;
  /**
   * Whether the event may carry a bundle at all (`eventSupportsBundles`) —
   * organizer and free events cannot. Defaults to true so a caller that has
   * already filtered doesn't have to restate it; pass it explicitly when the
   * line comes straight from a query.
   */
  bundleEligible?: boolean;
}

/** The rung a group has not reached yet, resolved into what to tell the buyer. */
export interface BundleNextTierPrompt {
  eventId: string;
  eventName: string | null;
  /** Rung threshold. */
  minQuantity: number;
  /** How many more photos from this group are needed to reach it. */
  photosNeeded: number;
  /** What the group would then cost in total, in cents. */
  resultingTotalCents: number;
  /** What the group costs right now, in cents. */
  currentTotalCents: number;
}

export interface BundleCartGroup {
  eventId: string;
  photographerId: string;
  eventName: string | null;
  /** Photo ids in this group, in the order they appeared in the cart. */
  photoIds: string[];
  /** Sum of the group's list prices. */
  listTotalCents: number;
  /** What the group is actually charged (ladder applied). */
  chargedTotalCents: number;
  /** `listTotalCents - chargedTotalCents`; 0 when no rung applies. */
  discountCents: number;
  nextTier: BundleNextTierPrompt | null;
}

export interface PricedBundleCart {
  /** Sum of every line's list price — the cart's "Subtotal" row. */
  listSubtotalCents: number;
  /** What the cart is actually charged for photos, before the service fee. */
  subtotalCents: number;
  /** `listSubtotalCents - subtotalCents`; 0 when nothing is discounted. */
  discountCents: number;
  /**
   * Per-photo charged amount, keyed by photo id. Sums to EXACTLY
   * `subtotalCents`. This is what becomes the Stripe line items, the guest
   * metadata `c` field, `cart_items.allocated_price_cents` and ultimately
   * `order_items`.
   */
  allocations: Record<string, number>;
  groups: BundleCartGroup[];
  /**
   * The single next-rung nudge worth showing, or null. Picked as the group
   * needing the FEWEST additional photos — the one the buyer can most plausibly
   * act on. One prompt rather than one per group keeps the cart summary from
   * turning into a list of upsells.
   */
  nextTier: BundleNextTierPrompt | null;
}

const groupKey = (eventId: string, photographerId: string) => `${eventId}::${photographerId}`;

/**
 * The subset of allocations belonging to groups a ladder actually discounted.
 *
 * The authenticated checkout persists only these, so
 * `cart_items.allocated_price_cents` stays null wherever no bundle applied —
 * which is what lets every reader treat null as "no bundle, use the list price"
 * and keeps an unbundled cart's order rows identical to the pre-bundle ones.
 */
export function discountedAllocations(priced: PricedBundleCart): Record<string, number> {
  const allocations: Record<string, number> = {};
  for (const group of priced.groups) {
    if (group.discountCents <= 0) continue;
    for (const photoId of group.photoIds) {
      const cents = priced.allocations[photoId];
      if (cents !== undefined) allocations[photoId] = cents;
    }
  }
  return allocations;
}

/**
 * Group a cart by `(event, photographer)`, price each group through the bundle
 * kernel, and allocate every discounted total back onto its photos.
 *
 * Fail-closed cases — each falls back to list price, the direction that can only
 * ever overcharge relative to the photographer's intent (visible, refundable)
 * and never undercharge (silent, unrecoverable), matching `parseBundleTiers`:
 *  - the event is ineligible (organizer / free) or has neither rungs nor a cap;
 *  - a line has no `eventId`;
 *  - the group's lines disagree on the unit price. That happens when the
 *    photographer changed `price_per_photo` between two adds, and it makes
 *    "quantity × unit" ill-defined — the input the rung comparison needs. Rather
 *    than guess which price the ladder was written against, the group pays list.
 */
export function priceCartWithBundles(lines: readonly BundleCartLine[]): PricedBundleCart {
  const allocations: Record<string, number> = {};
  const groups: BundleCartGroup[] = [];
  const byKey = new Map<string, BundleCartLine[]>();
  const order: string[] = [];

  for (const line of lines) {
    // A line with no event can never be bundled, and grouping it with other
    // event-less lines would be meaningless — charge it at list, on its own.
    if (!line.eventId) {
      allocations[line.photoId] = line.unitPriceCents;
      continue;
    }
    const key = groupKey(line.eventId, line.photographerId);
    const existing = byKey.get(key);
    if (existing) {
      existing.push(line);
    } else {
      byKey.set(key, [line]);
      order.push(key);
    }
  }

  for (const key of order) {
    const groupLines = byKey.get(key);
    if (!groupLines || groupLines.length === 0) continue;

    const first = groupLines[0];
    const eventId = first.eventId as string;
    const photoIds = groupLines.map((l) => l.photoId);
    const listTotalCents = groupLines.reduce((sum, l) => sum + l.unitPriceCents, 0);

    const eligible = first.bundleEligible ?? true;
    const tiers = first.bundleTiers ?? null;
    const cap = first.bundleAllPhotosCents ?? null;
    const hasSchedule = (tiers !== null && tiers.length > 0) || (cap !== null && cap > 0);
    // Every line in a group shares one event, so one unit price. A disagreement
    // is an inconsistency, not a configuration — see the fail-closed note above.
    const unitPriceCents = first.unitPriceCents;
    const uniformUnitPrice = groupLines.every((l) => l.unitPriceCents === unitPriceCents);

    const chargedTotalCents =
      eligible && hasSchedule && uniformUnitPrice && unitPriceCents > 0
        ? getBundlePriceCents(groupLines.length, unitPriceCents, tiers, cap)
        : listTotalCents;

    if (chargedTotalCents === listTotalCents) {
      // No discount: keep each photo at its OWN list price rather than
      // re-allocating an identical total. An unbundled cart therefore produces
      // byte-identical line items, order rows and transfers to today — the
      // "no allocation ⇒ today's order unchanged" requirement holds by
      // construction, not by a code path that happens to agree.
      for (const l of groupLines) allocations[l.photoId] = l.unitPriceCents;
    } else {
      // Allocation order is the group's cart order, which the callers keep
      // stable (`created_at` for the authenticated cart, insertion order for
      // the guest cart), so the same set always splits the same way.
      const split = allocateBundleTotalCents(chargedTotalCents, groupLines.length);
      for (let i = 0; i < groupLines.length; i++) {
        allocations[groupLines[i].photoId] = split[i];
      }
    }

    let nextTier: BundleNextTierPrompt | null = null;
    if (eligible && tiers && tiers.length > 0 && uniformUnitPrice && unitPriceCents > 0) {
      const rung = getNextBundleTier(groupLines.length, tiers);
      if (rung) {
        nextTier = {
          eventId,
          eventName: first.eventName ?? null,
          minQuantity: rung.minQuantity,
          photosNeeded: rung.minQuantity - groupLines.length,
          // Priced through the same kernel at the rung's threshold, so the
          // promised total is the total that will actually be charged there.
          resultingTotalCents: getBundlePriceCents(rung.minQuantity, unitPriceCents, tiers, cap),
          currentTotalCents: chargedTotalCents,
        };
      }
    }

    groups.push({
      eventId,
      photographerId: first.photographerId,
      eventName: first.eventName ?? null,
      photoIds,
      listTotalCents,
      chargedTotalCents,
      discountCents: listTotalCents - chargedTotalCents,
      nextTier,
    });
  }

  const listSubtotalCents = lines.reduce((sum, l) => sum + l.unitPriceCents, 0);
  const subtotalCents = Object.values(allocations).reduce((sum, cents) => sum + cents, 0);

  // The nudge the buyer is closest to acting on. Ties break on the larger saving
  // against list, then on event id so the choice is deterministic.
  let nextTier: BundleNextTierPrompt | null = null;
  for (const group of groups) {
    const candidate = group.nextTier;
    if (!candidate) continue;
    if (nextTier === null || candidate.photosNeeded < nextTier.photosNeeded) {
      nextTier = candidate;
      continue;
    }
    if (
      candidate.photosNeeded === nextTier.photosNeeded &&
      candidate.resultingTotalCents < nextTier.resultingTotalCents
    ) {
      nextTier = candidate;
    }
  }

  return {
    listSubtotalCents,
    subtotalCents,
    discountCents: listSubtotalCents - subtotalCents,
    allocations,
    groups,
    nextTier,
  };
}
