'use client';

import { format } from 'date-fns';
import { CalendarDays, Camera, ImageOff, Lock, MapPin } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { getActivityIcon } from '@/lib/activity-icon';
import { type EventStatus, isEventSoon } from '@/lib/event-status';
import { shouldSkipImageOptimization } from '@/lib/image-source';
import { cn } from '@/lib/utils';

export type EventCardLabels = {
  photo: string;
  photos: string;
  noPhotosYet: string;
  // Explore-side label shown over the cover when `status === 'upcoming'`.
  comingSoon?: string;
  // Owner-side label shown over the cover only when the event is happening
  // *soon* (see `isEventSoon` in lib/event-status.ts). Long-future events and
  // past events render no badge on the owner side.
  upcomingLabel?: string;
  // Shown in place of the cover when the image fails to load.
  imageUnavailable?: string;
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
  city: string;
  country: string;
  activity: string;
  // Localized name of the activity (e.g. "Mountain Bike"/"Bicicleta de Montaña").
  // Resolved by the caller from the locale's `activities` dictionary so the
  // tooltip stays in the user's language.
  activityLabel: string;
  photoCount: number;
  coverUrl?: string | null;
  /** /api/thumb/.../small.webp — used instead of coverUrl when available. */
  coverThumbUrl?: string | null;
  status?: EventStatus;
  // Explore mode: render the photographer's name/handle below the location.
  // Owner mode (where the viewer IS the photographer) leaves this undefined.
  photographer?: {
    username?: string | null;
    displayName?: string | null;
  };
  // Owner-only metadata. When set, surfaces a private-event indicator in the
  // bottom-right of the cover. Plain primitives only so the component can be
  // passed across the server/client boundary safely.
  ownerStats?: {
    isPublic: boolean;
    // Localized accessibility/tooltip label for the private-event lock icon.
    privateLabel: string;
  };
  // Floating top-left slot (e.g. dropdown trigger with edit/delete options).
  // Only rendered for owner mode.
  actions?: ReactNode;
  // Floating bottom-right slot (e.g. the talent save/bookmark button). Sits in
  // the corner left free in explore/talent mode (the VisibilityBadge there is
  // owner-only). The slotted control is responsible for swallowing its own
  // click so it doesn't navigate the card's link.
  saveSlot?: ReactNode;
  // Set on the first row of an above-the-fold grid so Next preloads the
  // cover and skips lazy-loading. Defaults to false — too many priority
  // images would defeat the preload budget.
  priority?: boolean;
  t?: EventCardLabels;
};

const DEFAULT_LABELS: EventCardLabels = {
  photo: 'photo',
  photos: 'photos',
  noPhotosYet: 'No photos yet',
};

function StatusBadge({
  status,
  labels,
  isOwner,
  offsetLeft,
}: {
  status?: EventStatus;
  date: string;
  labels: EventCardLabels;
  isOwner: boolean;
  // Push the badge to the right when the owner dropdown sits in the top-left.
  offsetLeft?: boolean;
}) {
  // Owner-side shows the upcoming indicator inline next to the date instead of
  // overlaying the cover — see `isUpcomingOwner` in `EventCard`.
  if (isOwner) return null;
  if (status !== 'upcoming') return null;
  const positionClass = offsetLeft ? 'left-12' : 'left-3 sm:left-2';
  return (
    <span
      className={`absolute ${positionClass} top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground sm:top-2`}
    >
      {labels.comingSoon ?? 'Coming Soon'}
    </span>
  );
}

// Renders an icon-only badge that overlays the cover. The label appears via
// Shadcn Tooltip (Radix), which portals the content to `document.body` and
// therefore escapes the cover's `overflow-hidden` clipping. On desktop the
// tooltip opens on hover; on touch devices we control it manually so a tap
// toggles it open/closed without Radix's pointer-enter auto-open getting in
// the way. Tapping the badge never navigates to the event — it lives inside
// a `<Link>` so the click handler swallows the event.
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
        // Touch devices: ignore Radix's pointer-driven open/close attempts
        // (pointer-enter fires on tap, which would flash the tooltip and
        // then immediately close it on pointer-leave). Our onClick below is
        // the single source of truth for tap-to-toggle.
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

function ActivityBadge({ activity, label }: { activity: string; label: string }) {
  const Icon = getActivityIcon(activity);
  return (
    <OverlayIconBadge
      label={label}
      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-sm sm:right-2 sm:top-2"
    >
      <Icon className="h-4 w-4" aria-hidden />
    </OverlayIconBadge>
  );
}

function VisibilityBadge({ isPublic, privateLabel }: { isPublic: boolean; privateLabel: string }) {
  // Public is the default state; only flag private events with a small lock
  // icon. Less visual noise when most events are public.
  if (isPublic) return null;
  return (
    <OverlayIconBadge
      label={privateLabel}
      className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-sm sm:right-2 sm:bottom-2 sm:h-7 sm:w-7"
    >
      <Lock className="h-4 w-4 sm:h-3 sm:w-3" aria-hidden />
    </OverlayIconBadge>
  );
}

export function EventCard({
  id,
  hrefParam,
  linkPrefix = '/dashboard/talent/events',
  name,
  date,
  city,
  country,
  activity,
  activityLabel,
  photoCount,
  coverUrl,
  coverThumbUrl,
  status,
  photographer,
  ownerStats,
  actions,
  saveSlot,
  priority = false,
  t = DEFAULT_LABELS,
}: EventCardProps) {
  const formattedDate = format(new Date(date), 'MMM d, yyyy');
  const location = [city, country].filter(Boolean).join(', ');
  const photographerHandle =
    photographer?.displayName || (photographer?.username ? `@${photographer.username}` : null);
  const isOwner = ownerStats !== undefined;
  // Owner-side surfaces a status accent (amber left border + inline pill) for
  // upcoming events within `UPCOMING_SOON_DAYS` — keeps the cover image clean
  // and ties the status to the date it describes.
  const isUpcomingOwner = isOwner && status === 'upcoming' && isEventSoon(date);
  // Track cover image loading so we can show a skeleton until it lands and
  // avoid rendering the badges/gradient over an empty placeholder.
  const [imageStatus, setImageStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const imageUnavailableLabel = t.imageUnavailable ?? 'Image unavailable';

  // Card is wrapped in a relative `<div>` (instead of just a `<Link>`) so the
  // optional `actions` slot can sit on top of the cover without nesting an
  // interactive element inside the link (a11y).
  return (
    <div className="group relative">
      <Link href={`${linkPrefix}/${hrefParam ?? id}`} className="block">
        <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-xl bg-muted">
          {(coverThumbUrl ?? coverUrl) ? (
            <>
              {/* Image always renders so `onLoad`/`onError` fire. We fade it
                  in once loaded so the swap from skeleton to photo doesn't
                  pop. Badges and the gradient overlay only mount after the
                  image is in to avoid "floating icons over empty space". */}
              <Image
                src={(coverThumbUrl ?? coverUrl) as string}
                alt={`${name} cover`}
                fill
                unoptimized={shouldSkipImageOptimization((coverThumbUrl ?? coverUrl) as string)}
                sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
                priority={priority}
                className={cn(
                  'object-cover transition-[opacity,transform] duration-300',
                  imageStatus === 'loaded' ? 'opacity-100 group-hover:scale-[1.03]' : 'opacity-0',
                )}
                onLoad={() => setImageStatus('loaded')}
                onError={() => setImageStatus('error')}
              />
              {imageStatus === 'loading' && <Skeleton className="absolute inset-0 rounded-xl" />}
              {imageStatus === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <ImageOff className="h-8 w-8 opacity-40" aria-hidden />
                  <span className="text-xs">{imageUnavailableLabel}</span>
                </div>
              )}
              {imageStatus === 'loaded' && (
                <>
                  <div className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent" />
                  <StatusBadge
                    status={status}
                    date={date}
                    labels={t}
                    isOwner={isOwner}
                    offsetLeft={!!actions}
                  />
                  <ActivityBadge activity={activity} label={activityLabel} />
                  <span className="absolute bottom-2 left-3 text-xs font-medium text-white drop-shadow-sm">
                    {photoCount} {photoCount === 1 ? t.photo : t.photos}
                  </span>
                  {ownerStats && (
                    <VisibilityBadge
                      isPublic={ownerStats.isPublic}
                      privateLabel={ownerStats.privateLabel}
                    />
                  )}
                  {saveSlot && <div className="absolute bottom-2 right-2 z-10">{saveSlot}</div>}
                </>
              )}
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Camera className="h-8 w-8 opacity-30" />
              <span className="text-xs">{t.noPhotosYet}</span>
              <StatusBadge
                status={status}
                date={date}
                labels={t}
                isOwner={isOwner}
                offsetLeft={!!actions}
              />
              <ActivityBadge activity={activity} label={activityLabel} />
              {ownerStats && (
                <VisibilityBadge
                  isPublic={ownerStats.isPublic}
                  privateLabel={ownerStats.privateLabel}
                />
              )}
              {saveSlot && <div className="absolute bottom-2 right-2 z-10">{saveSlot}</div>}
            </div>
          )}
        </div>

        <div className="space-y-1 px-1">
          <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-foreground">
            {name}
          </h3>

          <div className="space-y-0.5 text-sm text-muted-foreground md:text-xs">
            {location && (
              <p className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{location}</span>
              </p>
            )}
            <p className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{formattedDate}</span>
              {isUpcomingOwner && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t.upcomingLabel ?? 'Upcoming'}
                </span>
              )}
            </p>
            {photographerHandle && (
              <p className="flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{photographerHandle}</span>
              </p>
            )}
          </div>
        </div>
      </Link>

      {actions && (!coverUrl || imageStatus === 'loaded') && (
        <div className="absolute left-2 top-2">{actions}</div>
      )}
    </div>
  );
}
