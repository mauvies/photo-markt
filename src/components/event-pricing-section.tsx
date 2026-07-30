import { Card, CardContent } from '@/components/ui/card';
import { type BundleTier, getEffectivePerPhotoCents } from '@/lib/bundle-pricing';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';

/**
 * The buyer-facing pricing panel for an event (T-203, design D17).
 *
 * Neither event view is tabbed — the public page (`events/[shareCode]`) and the
 * talent-dashboard view (`dashboard/talent/events/[id]`) are both a single
 * scroll — so a volume ladder needs its own place rather than a wider meta line.
 * This is that place, and it is mounted at the SAME position on both surfaces
 * (directly under `EventMetaLine`, above the gallery) so the two can't drift
 * apart and quote different prices for one event.
 *
 * Renders nothing at all for a free event, and only the unit price when there is
 * no ladder — so an unbundled event's page looks exactly as it did before
 * bundles existed.
 */

export interface EventPricingSectionLabels {
  /** Section heading, e.g. "Pricing". */
  heading: string;
  /** Unit-price row label, e.g. "Single photo". */
  singlePhoto: string;
  /** Rung row label with `{n}`, e.g. "{n} photos or more". */
  photosOrMore: string;
  /** Per-photo equivalent with `{price}`, e.g. "{price} each". */
  eachSuffix: string;
  /** One-line explanation shown under the ladder. */
  ladderHint: string;
}

interface EventPricingSectionProps {
  /** Event unit price in EUROS (the `events.price_per_photo` column unit). */
  pricePerPhoto: number | null;
  /** Parsed ladder, or null when the event has none. */
  bundleTiers: BundleTier[] | null;
  labels: EventPricingSectionLabels;
  className?: string;
}

function formatCents(cents: number): string {
  return `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;
}

export function EventPricingSection({
  pricePerPhoto,
  bundleTiers,
  labels,
  className,
}: EventPricingSectionProps) {
  // Free event — nothing to price, so no panel at all.
  if (pricePerPhoto === null || pricePerPhoto <= 0) return null;

  const unitCents = Math.round(pricePerPhoto * 100);
  const tiers = bundleTiers ?? [];

  // No ladder: the meta line already states the unit price, so a whole panel
  // repeating it would be noise. Keeping the page identical to today for
  // unbundled events is deliberate.
  if (tiers.length === 0) return null;

  return (
    <Card className={className}>
      <CardContent className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground">{labels.heading}</h2>
        <dl className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-muted-foreground">{labels.singlePhoto}</dt>
            <dd className="text-sm font-medium text-foreground">{formatCents(unitCents)}</dd>
          </div>
          {tiers.map((tier) => (
            <div
              key={tier.minQuantity}
              className="flex items-baseline justify-between gap-4 border-t border-border pt-2"
            >
              <dt className="text-sm text-muted-foreground">
                {labels.photosOrMore.replace('{n}', String(tier.minQuantity))}
              </dt>
              <dd className="text-right">
                <span className="text-sm font-semibold text-foreground">
                  {formatCents(tier.totalPriceCents)}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {labels.eachSuffix.replace(
                    '{price}',
                    formatCents(getEffectivePerPhotoCents(tier)),
                  )}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">{labels.ladderHint}</p>
      </CardContent>
    </Card>
  );
}
