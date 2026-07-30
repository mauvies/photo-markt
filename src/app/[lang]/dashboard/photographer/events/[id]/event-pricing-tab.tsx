// This tab is a Server Component: a read-only table with no state, no handlers
// and no browser APIs. It once carried `'use client'` only to work around
// calling `buttonVariants` — which a Server Component genuinely cannot do while
// importing it from the `'use client'` module `ui/button`. The directive-free
// `ui/button-variants` exists precisely for this (T-213), so the import below is
// the fix and the client boundary goes away instead of shipping a static table
// to the browser bundle.
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  type BundleTier,
  getAllPhotosBreakEvenQuantity,
  getEffectivePerPhotoCents,
} from '@/lib/bundle-pricing';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { cn } from '@/lib/utils';

type BundlePricingT = Dictionary['bundlePricing'];

interface EventPricingTabProps {
  t: BundlePricingT;
  /** Label for the edit affordance, reused from the details dictionary. */
  editLabel: string;
  /** Event unit price in EUROS (`events.price_per_photo`'s unit), or null when free. */
  pricePerPhoto: number | null;
  /** Parsed ladder, or null when the event has none. */
  bundleTiers: BundleTier[] | null;
  /**
   * The event's "all photos" flat price in cents (T-204). Both event actions
   * validate and persist it, so leaving it out of this tab meant a photographer
   * could save a Foto-Flat and then be shown a pricing summary that denied it
   * existed — the same omission the buyer-facing `EventPricingSection` had.
   */
  bundleAllPhotosCents: number | null;
  /**
   * Set when the event is an organizer event. Those can never carry a ladder
   * (several possible sellers, no revenue split to charge a discount against),
   * so the tab shows a notice and hides the edit link. Eligibility is otherwise
   * decided by the price, which is already a prop.
   */
  isOrganizerEvent: boolean;
  /** Link to the scoped pricing-edit page (`/edit?section=pricing`). */
  editHref: string;
  /** Localized "Free" label, reused from the details dictionary. */
  freeLabel: string;
}

function formatCents(cents: number): string {
  return `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;
}

/**
 * The `Pricing` top-level tab on the photographer's event page (T-203, D17).
 *
 * READ-ONLY, with an Edit link — exactly the shape the `Details` tab already
 * established (T-179). Editing happens on the scoped `/edit?section=pricing`
 * route, which keeps `/edit` the only surface that writes a field and avoids
 * making this tab a second, inconsistent edit surface.
 */
export function EventPricingTab({
  t,
  editLabel,
  pricePerPhoto,
  bundleTiers,
  bundleAllPhotosCents,
  isOrganizerEvent,
  editHref,
  freeLabel,
}: EventPricingTabProps) {
  const isFree = pricePerPhoto === null || pricePerPhoto <= 0;
  const unitCents = isFree ? 0 : Math.round(pricePerPhoto * 100);
  const tiers = bundleTiers ?? [];
  const allPhotosCents =
    bundleAllPhotosCents != null && bundleAllPhotosCents > 0 ? bundleAllPhotosCents : null;
  // Where the ceiling starts being the cheaper option — derived from the two live
  // values, so it can't go stale when the unit price changes.
  const allPhotosBreakEven = getAllPhotosBreakEvenQuantity(allPhotosCents, unitCents);
  // A ceiling with no rungs is a complete configuration ("€3 a photo, or €25 for
  // all of them"), so "has a schedule" must not mean "has rungs".
  const hasSchedule = tiers.length > 0 || allPhotosCents !== null;

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.heading}</h2>
        {/* An organizer event can never carry a ladder, and its price lives
            elsewhere — offering an edit link would lead to a form with nothing
            to change. */}
        {isOrganizerEvent ? null : (
          <Link
            href={editHref}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              '-mr-2 text-muted-foreground',
            )}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {editLabel}
          </Link>
        )}
      </div>

      <dl className="mt-4 space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-muted-foreground">{t.singlePhoto}</dt>
          <dd className="text-sm font-medium text-foreground">
            {isFree ? freeLabel : formatCents(unitCents)}
          </dd>
        </div>
        {tiers.map((tier) => (
          <div
            key={tier.minQuantity}
            className="flex items-baseline justify-between gap-4 border-t border-border pt-2"
          >
            <dt className="text-sm text-muted-foreground">
              {t.photosOrMore.replace('{n}', String(tier.minQuantity))}
            </dt>
            <dd className="text-right">
              <span className="text-sm font-semibold text-foreground">
                {formatCents(tier.totalPriceCents)}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {t.effectivePerPhoto.replace(
                  '{price}',
                  formatCents(getEffectivePerPhotoCents(tier)),
                )}
              </span>
            </dd>
          </div>
        ))}
        {/* The ceiling sits last: validation keeps it strictly above every rung
            total, so it is the final step of the same ladder. */}
        {allPhotosCents !== null ? (
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
            <dt className="text-sm text-muted-foreground">{t.allPhotos}</dt>
            <dd className="text-right">
              <span className="text-sm font-semibold text-foreground">
                {formatCents(allPhotosCents)}
              </span>
              {allPhotosBreakEven !== null ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t.allPhotosBreakEven.replace('{n}', String(allPhotosBreakEven))}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-4 text-xs text-muted-foreground">
        {isOrganizerEvent
          ? t.unavailableOrganizer
          : isFree
            ? t.unavailableFree
            : hasSchedule
              ? t.laddersDescription
              : t.noLadder}
      </p>
    </section>
  );
}
