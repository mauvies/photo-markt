import { Camera, MapPin } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

type Labels = {
  locationFormat: string;
  photographerSince: string;
  eventsCount: string;
  eventsCountOne: string;
  photosCount: string;
  photosCountOne: string;
};

type PhotographerProfileHeaderProps = {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  countryCode: string | null;
  createdAt: string;
  eventCount: number;
  photoCount: number;
  labels: Labels;
};

type Stat = { value: number; label: string };

function formatCount(n: number, singular: string, plural: string): string {
  return (n === 1 ? singular : plural).replace('{n}', String(n));
}

/**
 * Shared profile header used by both the public photographer page and the
 * dashboard preview. Two responsive shapes:
 *
 *  - Mobile (< md): avatar top-left with the stat tiles to its right (centered
 *    with the avatar); name, @handle, bio and location/since stacked below.
 *  - Desktop (md+): large avatar on the left, name + @handle + inline flat stats
 *    stacked in a column to its right, bio + meta below.
 *
 * The `md:contents` on the avatar row promotes the avatar to sit beside the name
 * column on desktop (the mobile stat tiles are hidden there). Both pages render
 * this once; nothing else owns the header markup.
 */
export function PhotographerProfileHeader({
  displayName,
  username,
  avatarUrl,
  bio,
  city,
  countryCode,
  createdAt,
  eventCount,
  photoCount,
  labels,
}: PhotographerProfileHeaderProps) {
  const location =
    city && countryCode
      ? labels.locationFormat.replace('{city}', city).replace('{country}', countryCode)
      : null;
  const sinceYear = new Date(createdAt).getFullYear();
  const sinceLabel = labels.photographerSince.replace('{year}', String(sinceYear));

  const stats: Stat[] = [
    {
      value: eventCount,
      label: formatCount(eventCount, labels.eventsCountOne, labels.eventsCount),
    },
    {
      value: photoCount,
      label: formatCount(photoCount, labels.photosCountOne, labels.photosCount),
    },
  ];

  return (
    <>
      <section className="flex flex-col md:flex-row md:items-center md:gap-8">
        {/* Avatar row. On mobile: avatar (left) + stat tiles (right), centered
            with the avatar. On desktop `md:contents` dissolves this wrapper so
            the avatar sits directly beside the name column and the tiles hide. */}
        <div className="flex items-center gap-4 md:contents">
          <div
            className={cn(
              'relative h-24 w-24 shrink-0 overflow-hidden rounded-full bg-muted md:h-36 md:w-36',
              !avatarUrl && 'ring-2 ring-border',
            )}
          >
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                fill
                sizes="(min-width: 768px) 160px, 96px"
                className="object-cover"
                loading="eager"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Camera className="h-10 w-10 text-muted-foreground md:h-12 md:w-12" aria-hidden />
              </div>
            )}
          </div>

          {/* Mobile-only stat tiles — right of the avatar, centered with it. */}
          <div className="ml-auto mr-6 flex justify-center shrink-0 gap-3 md:hidden">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col items-center rounded-xl border bg-card px-6 py-3 text-center shadow-sm"
              >
                <span className="text-lg font-bold tracking-tight">{stat.value}</span>
                <span className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                  {stat.label.replace(/^\d+\s+/, '')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Name + @handle — below the avatar on mobile, beside it on desktop.
            Desktop also carries the inline flat stats here. */}
        <div className="mt-3 min-w-0 md:mt-0 md:flex-1">
          <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl md:text-4xl">
            {displayName}
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">@{username}</p>

          {/* Desktop-only inline stats — flat Instagram-style row, no card chrome. */}
          <div className="hidden md:flex md:flex-wrap md:gap-x-8 md:gap-y-2">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-1.5">
                <span className="text-xl font-semibold tracking-tight">{stat.value}</span>
                <span className="text-sm text-muted-foreground">
                  {stat.label.replace(/^\d+\s+/, '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {bio && <p className="mt-4 max-w-prose text-sm leading-relaxed sm:text-base">{bio}</p>}

      {(location || sinceYear) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              <span>{location}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Camera className="h-4 w-4 shrink-0" aria-hidden />
            <span>{sinceLabel}</span>
          </span>
        </div>
      )}
    </>
  );
}
