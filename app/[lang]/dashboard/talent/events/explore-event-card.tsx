'use client';

import { format } from 'date-fns';
import { Camera } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';

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
  pricePerPhoto: number | null;
  photographerUsername?: string | null;
  photographerDisplayName?: string | null;
  linkPrefix?: string;
  t?: { photos: string; photo: string; from: string; free: string; noPhotosYet: string };
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
  pricePerPhoto,
  photographerUsername,
  photographerDisplayName,
  linkPrefix = '/dashboard/talent/events',
  t = {
    photos: 'photos',
    photo: 'photo',
    from: 'From',
    free: 'Free',
    noPhotosYet: 'No photos yet',
  },
}: ExploreEventCardProps) {
  const activityLabel = activityOptions.find((opt) => opt.value === activity)?.label ?? activity;
  const formattedDate = format(new Date(date), 'MMM d, yyyy');
  const location = [city, country].filter(Boolean).join(', ');
  const photographerHandle =
    photographerDisplayName || (photographerUsername ? `@${photographerUsername}` : null);
  const priceText =
    pricePerPhoto !== null
      ? `${t.from} $${pricePerPhoto % 1 === 0 ? pricePerPhoto : pricePerPhoto.toFixed(2)}`
      : t.free;

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
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
            {/* Subtle gradient for photo count legibility */}
            <div className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent" />
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
          </div>
        )}
      </div>

      {/* Info below image */}
      <div className="flex items-start justify-between gap-3 px-1">
        {/* Left column */}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-snug text-foreground">{name}</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{location}</p>
          <p className="text-sm text-muted-foreground">{formattedDate}</p>
          {photographerHandle && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{photographerHandle}</p>
          )}
        </div>

        {/* Right column */}
        <div className="shrink-0 text-right">
          <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {activityLabel}
          </span>
          <p className="mt-1.5 text-xs text-foreground">{priceText}</p>
        </div>
      </div>
    </Link>
  );
}
