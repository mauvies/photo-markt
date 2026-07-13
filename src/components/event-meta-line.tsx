import Link from 'next/link';
import { formatEventDate, formatSessionTime } from '@/lib/format-date';
import { formatEventLocation } from '@/lib/format-location';
import { cn } from '@/lib/utils';

interface EventMetaLineProps {
  /** ISO event date. */
  date: string;
  /** Manual session start time ("HH:MM"/"HH:MM:SS"); shown right after the
   * date when present, omitted otherwise (T-106). */
  sessionTime?: string | null;
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
  city,
  state,
  country,
  locale,
  perPhotoLabel,
  pricePerPhoto,
  photographerName,
  className,
}: EventMetaLineProps) {
  const formattedDate = formatEventDate(date, locale);
  const formattedTime = formatSessionTime(sessionTime, locale);
  const location = formatEventLocation({ city, state, country });
  const formattedCity = location ? location[0]?.toUpperCase() + location.slice(1) : '';

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
          • ${pricePerPhoto.toFixed(2)} {perPhotoLabel}
        </>
      ) : null}
    </div>
  );
}
