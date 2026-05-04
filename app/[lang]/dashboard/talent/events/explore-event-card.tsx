'use client';

import { format } from 'date-fns';
import { CalendarDays, Camera, MapPin } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import type { EventStatus } from '@/lib/event-status';

type ExploreEventCardProps = {
  id: string;
  hrefParam?: string;
  name: string;
  date: string;
  city: string;
  country: string;
  activity: string;
  photoCount: number;
  coverUrl?: string | null;
  photographerUsername?: string | null;
  photographerDisplayName?: string | null;
  status?: EventStatus;
  linkPrefix?: string;
  t?: {
    photos: string;
    photo: string;
    noPhotosYet: string;
    comingSoon?: string;
  };
};

export function ExploreEventCard({
  id,
  hrefParam,
  name,
  date,
  city,
  country,
  activity,
  photoCount,
  coverUrl,
  photographerUsername,
  photographerDisplayName,
  status,
  linkPrefix = '/dashboard/talent/events',
  t = {
    photos: 'photos',
    photo: 'photo',
    noPhotosYet: 'No photos yet',
  },
}: ExploreEventCardProps) {
  const activityLabel = activityOptions.find((opt) => opt.value === activity)?.label ?? activity;
  const formattedDate = format(new Date(date), 'MMM d, yyyy');
  const location = [city, country].filter(Boolean).join(', ');
  const photographerHandle =
    photographerDisplayName || (photographerUsername ? `@${photographerUsername}` : null);

  return (
    <Link href={`${linkPrefix}/${hrefParam ?? id}`} className="group block">
      {/* Image */}
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
            {/* Subtle gradient for photo count legibility */}
            <div className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent" />
            {/* Coming Soon badge */}
            {status === 'upcoming' && (
              <span className="absolute left-2 top-2 rounded-full bg-primary/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                {t.comingSoon ?? 'Coming Soon'}
              </span>
            )}
            {/* Photo count — bottom-left */}
            <div className="absolute bottom-0 left-0 p-3">
              <span className="text-xs font-medium text-white drop-shadow-sm">
                {photoCount} {photoCount === 1 ? t.photo : t.photos}
              </span>
            </div>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Camera className="h-8 w-8 opacity-30" />
            <span className="text-xs">{t.noPhotosYet}</span>
            {status === 'upcoming' && (
              <span className="absolute left-2 top-2 rounded-full bg-primary/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                {t.comingSoon ?? 'Coming Soon'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Info below image — single column */}
      <div className="space-y-1 px-1">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{name}</h3>

        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
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

        <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {activityLabel}
        </span>
      </div>
    </Link>
  );
}
