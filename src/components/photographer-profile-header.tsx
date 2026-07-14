import { Camera, MapPin } from 'lucide-react';
import Image from 'next/image';

type Labels = {
  locationFormat: string;
  photographerSince: string;
  eventsCount: string;
  eventsCountOne: string;
  photosCount: string;
  photosCountOne: string;
  photosSold: string;
  photosSoldOne: string;
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
  /** When 0 the "photos sold" tile is hidden — surfacing "0 sold" undermines the profile. */
  photosSoldCount: number;
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
 *  - Mobile (< md): vertical stack — avatar, name, @handle, bio, location/since
 *    meta, then the existing card-style stat tiles below.
 *  - Desktop (md+): Instagram-style — large avatar on the left, name + @handle
 *    + inline flat stats stacked in a column to its right, bio + meta below.
 *
 * Both pages render this once; nothing else owns the header markup.
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
  photosSoldCount,
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
  if (photosSoldCount > 0) {
    stats.push({
      value: photosSoldCount,
      label: formatCount(photosSoldCount, labels.photosSoldOne, labels.photosSold),
    });
  }

  return (
    <>
      <section className="flex flex-col items-center md:flex-row md:gap-8">
        <div className="relative mb-5 h-28 w-28 overflow-hidden rounded-full bg-muted ring-2 ring-border sm:h-32 sm:w-32 md:mb-0 md:h-40 md:w-40 md:shrink-0">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={displayName}
              fill
              sizes="(min-width: 768px) 160px, 128px"
              className="object-cover"
              loading="eager"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Camera className="h-12 w-12 text-muted-foreground" aria-hidden />
            </div>
          )}
        </div>

        <div className="md:flex-1">
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {displayName}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">@{username}</p>

          {/* Desktop-only inline stats — flat Instagram-style row, no card chrome. */}
          <div className="mt-4 hidden md:flex md:flex-wrap md:gap-x-8 md:gap-y-2">
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
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
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

      {/* Mobile-only stat tiles — preserved byte-for-byte from the previous
          ProfileMetrics so the phone viewport is unchanged. */}
      <section
        className={`mt-6 grid gap-3 sm:mt-10 sm:gap-4 md:hidden ${
          stats.length === 3 ? 'grid-cols-3 sm:max-w-xl' : 'grid-cols-2 sm:max-w-md'
        }`}
      >
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col items-center rounded-xl border bg-card px-3 py-4 text-center shadow-sm sm:py-5"
          >
            <span className="text-xl font-bold tracking-tight sm:text-2xl">{stat.value}</span>
            <span className="mt-1 text-xs text-muted-foreground sm:text-sm">
              {stat.label.replace(/^\d+\s+/, '')}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
