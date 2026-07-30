import Link from 'next/link';
import { type BundleOfferLabels, resolveBundleOfferLabel } from '@/lib/bundle-offer-label';
import type { BundleTier } from '@/lib/bundle-pricing';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import { formatEventDate, formatSessionTimeRange } from '@/lib/format-date';
import { formatEventLocation } from '@/lib/format-location';
import { cn } from '@/lib/utils';

interface EventMetaLineProps {
  /** ISO event date. */
  date: string;
  /** Manual session start time ("HH:MM"/"HH:MM:SS"); shown right after the
   * date when present, omitted otherwise (T-106). */
  sessionTime?: string | null;
  /** Manual session end time ("HH:MM"/"HH:MM:SS"); shown as a range with the
   * start ("09:30 – 12:00") when both are present (T-180). */
  sessionEndTime?: string | null;
  /** Event city. */
  city: string;
  /** State/province + country, joined with the city into the location segment
   * when present (T-107). Legacy events (empty state/country) show city only. */
  state?: string | null;
  country?: string | null;
  /** Page locale (`lang`) — drives the natural date format. */
  locale: string;
  /** Localized "per photo" suffix for the price segment. */
  perPhotoLabel: string;
  /** Flat price in dollars; the price segment is omitted when null/undefined. */
  pricePerPhoto?: number | null;
  /**
   * Volume-pricing ladder (T-204). When present, the line appends the event's
   * best bundle offer after the unit price — a card reading "€5.00 per photo"
   * on an event where eight photos cost €20 is quoting a price that is only true
   * for a buyer taking one photo.
   */
  bundleTiers?: BundleTier[] | null;
  /** The event's "all photos" flat price in cents, if set (T-204). */
  bundleAllPhotosCents?: number | null;
  /** Copy for the bundle segment; omitted ⇒ no bundle segment is rendered. */
  bundleOfferLabels?: BundleOfferLabels;
  /** Event photographer's username — rendered as a link to their public
   * profile, positioned just before the price. Omitted when absent. */
  photographerName?: string | null;
  className?: string;
}

/**
 * The metadata line under an event title: date · city · photographer · price.
 * Shared by the public event page and the talent-dashboard event page (T-103)
 * so the two never diverge in date format or field order.
 */
export function EventMetaLine({
  date,
  sessionTime,
  sessionEndTime,
  city,
  state,
  country,
  locale,
  perPhotoLabel,
  pricePerPhoto,
  bundleTiers,
  bundleAllPhotosCents,
  bundleOfferLabels,
  photographerName,
  className,
}: EventMetaLineProps) {
  const formattedDate = formatEventDate(date, locale);
  const formattedTime = formatSessionTimeRange(sessionTime, sessionEndTime, locale);
  const location = formatEventLocation({ city, state, country });
  const formattedCity = location ? location[0]?.toUpperCase() + location.slice(1) : '';
  // Only meaningful next to a unit price — a free event has nothing to discount.
  const bundleOffer =
    bundleOfferLabels && pricePerPhoto != null && pricePerPhoto > 0
      ? resolveBundleOfferLabel(bundleTiers, bundleAllPhotosCents, bundleOfferLabels)
      : null;

  return (
    <div className={cn('text-sm leading-relaxed text-muted-foreground', className)}>
      {formattedDate}
      {formattedTime ? <> • {formattedTime}</> : null}
      {formattedCity ? <> • {formattedCity}</> : null}
      {photographerName ? (
        <>
          {' '}
          •{' '}
          <Link
            href={`/${locale}/photographer/${encodeURIComponent(photographerName)}`}
            className="hover:text-foreground hover:underline"
          >
            @{photographerName}
          </Link>
        </>
      ) : null}
      {pricePerPhoto != null ? (
        <>
          {' '}
          • {PLATFORM_CURRENCY_SYMBOL}
          {pricePerPhoto.toFixed(2)} {perPhotoLabel}
        </>
      ) : null}
      {bundleOffer ? <> • {bundleOffer}</> : null}
    </div>
  );
}
