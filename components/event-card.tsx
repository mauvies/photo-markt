'use client';

import { format } from 'date-fns';
import { CalendarDays, Camera, Lock, MapPin } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { type EventStatus, isEventSoon } from '@/lib/event-status';

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
  photoCount: number;
  coverUrl?: string | null;
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
    // Localized accessibility label for the private-event lock icon.
    privateLabel: string;
  };
  // Floating top-right slot (e.g. dropdown trigger with edit/delete options).
  // Only rendered for owner mode.
  actions?: ReactNode;
  t?: EventCardLabels;
};

const DEFAULT_LABELS: EventCardLabels = {
  photo: 'photo',
  photos: 'photos',
  noPhotosYet: 'No photos yet',
};

function StatusBadge({
  status,
  date,
  labels,
  isOwner,
}: {
  status?: EventStatus;
  date: string;
  labels: EventCardLabels;
  isOwner: boolean;
}) {
  // Explore-side: hint at any upcoming event so browsers know it's not live
  // yet. Keep the original "Coming Soon" framing.
  if (!isOwner) {
    if (status !== 'upcoming') return null;
    return (
      <span className="absolute left-2 top-2 rounded-full bg-primary/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
        {labels.comingSoon ?? 'Coming Soon'}
      </span>
    );
  }

  // Owner-side: only flag events that are imminent (within `UPCOMING_SOON_DAYS`
  // days). Past and far-future events stay unbadged so the dashboard grid
  // doesn't get noisy.
  if (status === 'upcoming' && isEventSoon(date)) {
    return (
      <span className="absolute left-2 top-2 rounded-full bg-primary/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
        {labels.upcomingLabel ?? 'Upcoming'}
      </span>
    );
  }
  return null;
}

function VisibilityBadge({ isPublic, privateLabel }: { isPublic: boolean; privateLabel: string }) {
  // Public is the default state; only flag private events with a small lock
  // icon. Less visual noise when most events are public.
  if (isPublic) return null;
  return (
    <span
      role="img"
      aria-label={privateLabel}
      title={privateLabel}
      className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-sm"
    >
      <Lock className="h-3 w-3" aria-hidden />
    </span>
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
  photoCount,
  coverUrl,
  status,
  photographer,
  ownerStats,
  actions,
  t = DEFAULT_LABELS,
}: EventCardProps) {
  const activityLabel = activityOptions.find((opt) => opt.value === activity)?.label ?? activity;
  const formattedDate = format(new Date(date), 'MMM d, yyyy');
  const location = [city, country].filter(Boolean).join(', ');
  const photographerHandle =
    photographer?.displayName || (photographer?.username ? `@${photographer.username}` : null);
  const isOwner = ownerStats !== undefined;

  // Card is wrapped in a relative `<div>` (instead of just a `<Link>`) so the
  // optional `actions` slot can sit on top of the cover without nesting an
  // interactive element inside the link (a11y).
  return (
    <div className="group relative">
      <Link href={`${linkPrefix}/${hrefParam ?? id}`} className="block">
        <div className="relative mb-3 aspect-square w-full overflow-hidden rounded-xl bg-muted">
          {coverUrl ? (
            <>
              <Image
                src={coverUrl}
                alt={`${name} cover`}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
                className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent" />
              <StatusBadge status={status} date={date} labels={t} isOwner={isOwner} />
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
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Camera className="h-8 w-8 opacity-30" />
              <span className="text-xs">{t.noPhotosYet}</span>
              <StatusBadge status={status} date={date} labels={t} isOwner={isOwner} />
              {ownerStats && (
                <VisibilityBadge
                  isPublic={ownerStats.isPublic}
                  privateLabel={ownerStats.privateLabel}
                />
              )}
            </div>
          )}
        </div>

        <div className="space-y-1 px-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {name}
          </h3>

          <div className="space-y-0.5 text-xs text-muted-foreground">
            {location && (
              <p className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{location}</span>
              </p>
            )}
            <p className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{formattedDate}</span>
            </p>
            {photographerHandle && (
              <p className="flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{photographerHandle}</span>
              </p>
            )}
          </div>

          <div className="pt-1">
            <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {activityLabel}
            </span>
          </div>
        </div>
      </Link>

      {actions && <div className="absolute right-2 top-2">{actions}</div>}
    </div>
  );
}
