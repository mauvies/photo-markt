import Link from 'next/link';
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
   * Volume-pricing ladder (T-204). Its presence SUPPRESSES the price segment
   * entirely — see the note on the component.
   */
  bundleTiers?: BundleTier[] | null;
  /** The event's "all photos" flat price in cents, if set (T-204). */
  bundleAllPhotosCents?: number | null;
  /** Event photographer's username — rendered as a link to their public
   * profile, positioned just before the price. Omitted when absent. */
  photographerName?: string | null;
  className?: string;
}

/**
 * The metadata line under an event title: date · city · photographer · price.
 * Shared by the public event page and the talent-dashboard event page (T-103)
 * so the two never diverge in date format or field order.
 *
 * **The price segment appears only when the event has NO volume pricing.** Once a
 * ladder or an "all photos" ceiling is configured, `EventPricingSection` renders
 * right below this line and states the unit price AND every package — so
 * repeating the unit price here is redundant, and worse, it is the *least*
 * relevant number on an event whose whole point is the package price. Exactly one
 * surface quotes the price: the section when there is a schedule, this line when
 * there isn't (the section renders nothing in that case, so dropping it here
 * unconditionally would lose the price altogether).
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
  photographerName,
  className,
}: EventMetaLineProps) {
  const formattedDate = formatEventDate(date, locale);
  const formattedTime = formatSessionTimeRange(sessionTime, sessionEndTime, locale);
  const location = formatEventLocation({ city, state, country });
  const formattedCity = location ? location[0]?.toUpperCase() + location.slice(1) : '';
  // A configured schedule moves the whole price story to `EventPricingSection`.
  const hasBundleSchedule =
    (bundleTiers != null && bundleTiers.length > 0) ||
    (bundleAllPhotosCents != null && bundleAllPhotosCents > 0);
  const showPrice = pricePerPhoto != null && !hasBundleSchedule;

  return (
    // `mt-1` is a BASE class, not a caller's job: all three call sites (public
    // event page, photographer event page, talent event view) render this
    // directly under an <h1> with no `space-y-*` on the parent, so a caller
    // that forgets the margin butts the meta line against the title.
    <div className={cn('mt-1 text-sm leading-relaxed text-muted-foreground', className)}>
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
      {showPrice ? (
        <>
          {' '}
          • {PLATFORM_CURRENCY_SYMBOL}
          {pricePerPhoto.toFixed(2)} {perPhotoLabel}
        </>
      ) : null}
    </div>
  );
}
