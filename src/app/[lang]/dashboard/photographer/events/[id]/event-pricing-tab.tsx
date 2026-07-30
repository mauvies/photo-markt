'use client';

// Required, not incidental: `buttonVariants` lives in a client module
// (`ui/button`), and a Server Component cannot CALL a client function — only
// render one as a component. `EventInfoCard`, whose header/Edit-link pattern this
// mirrors, is a client component for exactly the same reason. `pnpm build`
// compiles this either way; the failure only surfaces when the tab renders.
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { type BundleTier, getEffectivePerPhotoCents } from '@/lib/bundle-pricing';
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
  isOrganizerEvent,
  editHref,
  freeLabel,
}: EventPricingTabProps) {
  const isFree = pricePerPhoto === null || pricePerPhoto <= 0;
  const unitCents = isFree ? 0 : Math.round(pricePerPhoto * 100);
  const tiers = bundleTiers ?? [];

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
      </dl>

      <p className="mt-4 text-xs text-muted-foreground">
        {isOrganizerEvent
          ? t.unavailableOrganizer
          : isFree
            ? t.unavailableFree
            : tiers.length === 0
              ? t.noLadder
              : t.laddersDescription}
      </p>
    </section>
  );
}
