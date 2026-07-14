'use client';

import { Camera, ImageOff, Lock } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { EventSaveButton } from '@/components/event-save-button';
import { EventShareButton } from '@/components/event-share-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { getActivityIcon } from '@/lib/activity-icon';
import { countryFlagEmoji } from '@/lib/country-flag';
import { type EventStatus, isEventSoon } from '@/lib/event-status';
import { formatEventDate, formatSessionTime } from '@/lib/format-date';
import { formatEventLocation } from '@/lib/format-location';
import { shouldSkipImageOptimization } from '@/lib/image-source';
import { cn } from '@/lib/utils';

export type EventCardLabels = {
  photo: string;
  photos: string;
  noPhotosYet: string;
  // Explore-side label shown over the cover when `status === 'upcoming'`.
  comingSoon?: string;
  // Owner-side label shown next to the date only when the event is happening
  // *soon* (see `isEventSoon` in lib/event-status.ts).
  upcomingLabel?: string;
  // Shown in place of the cover when the image fails to load.
  imageUnavailable?: string;
  // Tooltip for the share button in the title row (explore mode).
  share?: string;
};

type EventCardProps = {
  id: string;
  // Used as the URL segment after `linkPrefix`. Defaults to `id` if not given.
  hrefParam?: string;
  // Route prefix the card's link points to (e.g. '/events',
  // '/dashboard/talent/events', '/dashboard/photographer/events').
  linkPrefix?: string;
  name: string;
  date: string;
  /** Manual session time ("HH:mm", nullable — T-106). Shown next to the date. */
  sessionTime?: string | null;
  city: string;
  country: string;
  /** State/province, shown in the location line when present (T-107). */
  state?: string | null;
  activity: string;
  // Localized name of the activity (e.g. "Mountain Bike"/"Bicicleta de Montaña").
  activityLabel: string;
  photoCount: number;
  coverUrl?: string | null;
  /** /api/thumb/.../small.webp — used instead of coverUrl when available. */
  coverThumbUrl?: string | null;
  status?: EventStatus;
  // Explore mode: render the photographer's name/handle + avatar below a divider,
  // linking to their public profile. Owner mode leaves this undefined.
  photographer?: {
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
  // Owner-only metadata. When set, surfaces a private-event indicator in the
  // bottom-right of the cover, and switches the card to owner mode (no
  // share/save/photographer row).
  ownerStats?: {
    isPublic: boolean;
    // Localized accessibility/tooltip label for the private-event lock icon.
    privateLabel: string;
  };
  // Floating top-left slot (e.g. dropdown trigger with edit/delete options).
  // Only rendered for owner mode.
  actions?: ReactNode;
  // Fired after the (explore-mode) save toggle resolves — e.g. the favorites
  // grid drops a card when it's unsaved.
  onSaveToggled?: (saved: boolean) => void;
  // Set on the first row of an above-the-fold grid so Next preloads the
  // cover and skips lazy-loading.
  priority?: boolean;
  t?: EventCardLabels;
};

const DEFAULT_LABELS: EventCardLabels = {
  photo: 'photo',
  photos: 'photos',
  noPhotosYet: 'No photos yet',
};

// Renders an icon-only badge that overlays the cover. The label appears via
// Shadcn Tooltip (Radix), which portals the content to `document.body` and
// therefore escapes the cover's `overflow-hidden` clipping. On desktop the
// tooltip opens on hover; on touch devices we control it manually so a tap
// toggles it open/closed. Tapping the badge never navigates to the event.
function OverlayIconBadge({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  const isCoarse = useCoarsePointer();
  const [open, setOpen] = useState(false);

  const swallow = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (isCoarse) return;
        setOpen(next);
      }}
    >
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={className}
          onClick={(e) => {
            swallow(e);
            if (isCoarse) setOpen((o) => !o);
          }}
          onPointerDown={swallow}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function ActivityBadge({
  activity,
  label,
  offsetRight,
}: {
  activity: string;
  label: string;
  // Owner mode keeps the edit/delete dropdown in the top-left corner, so push
  // the activity indicator to the top-right there to avoid overlapping it.
  offsetRight?: boolean;
}) {
  const Icon = getActivityIcon(activity);
  const position = offsetRight ? 'right-2 top-2' : 'left-2 top-2';
  return (
    <OverlayIconBadge
      label={label}
      className={`absolute ${position} flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-sm`}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </OverlayIconBadge>
  );
}

function VisibilityBadge({ isPublic, privateLabel }: { isPublic: boolean; privateLabel: string }) {
  if (isPublic) return null;
  return (
    <OverlayIconBadge
      label={privateLabel}
      className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-sm"
    >
      <Lock className="h-3 w-3" aria-hidden />
    </OverlayIconBadge>
  );
}

function PhotographerRow({
  displayName,
  username,
  avatarUrl,
  locale,
}: {
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  locale: string;
}) {
  const name = displayName || (username ? `@${username}` : null);
  if (!name) return null;
  const initial = name.replace(/^@/, '').charAt(0).toUpperCase();

  const inner = (
    <span className="flex min-w-0 items-center gap-2">
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          width={20}
          height={20}
          unoptimized={shouldSkipImageOptimization(avatarUrl)}
          className="h-5 w-5 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
          {initial}
        </span>
      )}
      <span className="truncate text-sm leading-none text-muted-foreground">{name}</span>
    </span>
  );

  // The name links to the photographer's public profile. Kept OUTSIDE the
  // card's event `<Link>` (rendered as a sibling below the divider) so we
  // never nest an anchor inside another anchor.
  if (username) {
    return (
      <div className="mt-2.5 flex items-center border-t pt-2.5">
        <Link
          href={`/${locale}/photographer/${username}`}
          className="inline-flex max-w-full transition-opacity hover:opacity-80"
        >
          {inner}
        </Link>
      </div>
    );
  }
  return <div className="mt-3 border-t pt-3">{inner}</div>;
}

export function EventCard({
  id,
  hrefParam,
  linkPrefix = '/dashboard/talent/events',
  name,
  date,
  sessionTime,
  city,
  country,
  state,
  activity,
  activityLabel,
  photoCount,
  coverUrl,
  coverThumbUrl,
  status,
  photographer,
  ownerStats,
  actions,
  onSaveToggled,
  priority = false,
  t = DEFAULT_LABELS,
}: EventCardProps) {
  const { lang } = useParams<{ lang: string }>();
  const locale = lang ?? 'en';

  const eventHref = `${linkPrefix}/${hrefParam ?? id}`;
  const formattedDate = formatEventDate(date, locale) ?? '';
  const formattedTime = formatSessionTime(sessionTime, locale);
  const location = formatEventLocation({ city, state, country });
  const flag = countryFlagEmoji(country);
  const isOwner = ownerStats !== undefined;
  const isUpcomingOwner = isOwner && status === 'upcoming' && isEventSoon(date);
  const isUpcomingExplore = !isOwner && status === 'upcoming';

  const [imageStatus, setImageStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const imageUnavailableLabel = t.imageUnavailable ?? 'Image unavailable';
  const coverSrc = coverThumbUrl ?? coverUrl ?? null;

  // Public share URL — always the `/events/...` route, never the dashboard
  // prefix. Built client-side; `origin` is empty during SSR but the value is
  // only read inside the button's onClick (never in the DOM), so no mismatch.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const shareUrl = `${origin}/${locale}/events/${hrefParam ?? id}`;

  return (
    <div className="group relative overflow-hidden rounded-2xl border bg-card">
      {/* Cover */}
      <Link href={eventHref} className="block">
        <div className="relative aspect-[16/11] w-full overflow-hidden bg-muted">
          {coverSrc ? (
            <>
              {/* Skeleton sits BEHIND the image (earlier in DOM, both absolute)
                  so a priority cover can paint progressively over it. */}
              {imageStatus === 'loading' && <Skeleton className="absolute inset-0 rounded-none" />}
              <Image
                src={coverSrc}
                alt={`${name} cover`}
                fill
                unoptimized={shouldSkipImageOptimization(coverSrc)}
                sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
                priority={priority}
                className={cn(
                  'object-cover',
                  // Above-the-fold (priority) covers are LCP candidates: they
                  // must paint as soon as bytes arrive, never wait for
                  // hydration + onLoad + a fade. Below-the-fold covers keep the
                  // fade-in polish. (T-123)
                  priority
                    ? cn(
                        'transition-transform duration-300 group-hover:scale-[1.03]',
                        imageStatus === 'error' && 'opacity-0',
                      )
                    : cn(
                        'transition-[opacity,transform] duration-300',
                        imageStatus === 'loaded'
                          ? 'opacity-100 group-hover:scale-[1.03]'
                          : 'opacity-0',
                      ),
                )}
                onLoad={() => setImageStatus('loaded')}
                onError={() => setImageStatus('error')}
              />
              {imageStatus === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <ImageOff className="h-8 w-8 opacity-40" aria-hidden />
                  <span className="text-xs">{imageUnavailableLabel}</span>
                </div>
              )}
              {imageStatus === 'loaded' && (
                <>
                  <div className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent" />
                  <ActivityBadge
                    activity={activity}
                    label={activityLabel}
                    offsetRight={!!actions}
                  />
                  {isUpcomingExplore && (
                    <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                      {t.comingSoon ?? 'Coming Soon'}
                    </span>
                  )}
                  <span className="absolute bottom-2 left-3 text-xs font-medium text-white drop-shadow-sm">
                    {photoCount} {photoCount === 1 ? t.photo : t.photos}
                  </span>
                  {ownerStats && (
                    <VisibilityBadge
                      isPublic={ownerStats.isPublic}
                      privateLabel={ownerStats.privateLabel}
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Camera className="h-8 w-8 opacity-30" />
              <span className="text-xs">{t.noPhotosYet}</span>
              <ActivityBadge activity={activity} label={activityLabel} offsetRight={!!actions} />
              {ownerStats && (
                <VisibilityBadge
                  isPublic={ownerStats.isPublic}
                  privateLabel={ownerStats.privateLabel}
                />
              )}
            </div>
          )}
        </div>
      </Link>

      {/* Info section */}
      <div className="p-3">
        {/* Title + (explore) share/save icons */}
        <div className="flex items-start justify-between gap-1">
          <Link href={eventHref} className="block min-w-0 flex-1">
            <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-foreground">
              {name}
            </h3>
          </Link>
          {!isOwner && (
            <div className="-mr-2 -mt-1 flex shrink-0 items-center">
              <EventShareButton
                eventName={name}
                eventUrl={shareUrl}
                tooltip={t.share ?? 'Share'}
                className="size-8 [&_svg]:size-4"
              />
              <EventSaveButton
                eventId={id}
                variant="icon"
                className="size-8"
                onToggled={onSaveToggled}
              />
            </div>
          )}
        </div>

        <Link href={eventHref} className="block">
          {location && (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-foreground/90">
              <span className="truncate">{location}</span>
              {flag && (
                <span aria-hidden className="shrink-0">
                  {flag}
                </span>
              )}
            </p>
          )}

          <div className="mt-1 flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 truncate">
              {formattedDate}
              {isUpcomingOwner && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t.upcomingLabel ?? 'Upcoming'}
                </span>
              )}
            </span>
            {formattedTime && <span className="shrink-0">{formattedTime}</span>}
          </div>
        </Link>

        {!isOwner && photographer && (
          <PhotographerRow
            displayName={photographer.displayName}
            username={photographer.username}
            avatarUrl={photographer.avatarUrl}
            locale={locale}
          />
        )}
      </div>

      {actions && (!coverSrc || imageStatus === 'loaded') && (
        <div className="absolute left-2 top-2 z-10">{actions}</div>
      )}
    </div>
  );
}
