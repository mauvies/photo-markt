import { Camera, MapPin } from 'lucide-react';
import Image from 'next/image';

type ProfileHeroProps = {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  countryCode: string | null;
  createdAt: string;
  labels: {
    locationFormat: string;
    photographerSince: string;
  };
};

/**
 * Public profile hero: avatar + name + handle + bio + location + member-since.
 * Each meta row is conditional on the data being present, so a photographer
 * with only a username still renders cleanly.
 */
export function ProfileHero({
  displayName,
  username,
  avatarUrl,
  bio,
  city,
  countryCode,
  createdAt,
  labels,
}: ProfileHeroProps) {
  const location =
    city && countryCode
      ? labels.locationFormat.replace('{city}', city).replace('{country}', countryCode)
      : null;
  const sinceYear = new Date(createdAt).getFullYear();
  const sinceLabel = labels.photographerSince.replace('{year}', String(sinceYear));

  return (
    <section className="flex flex-col items-start">
      <div className="relative mb-5 h-28 w-28 overflow-hidden rounded-full bg-muted ring-2 ring-border sm:h-32 sm:w-32">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName}
            fill
            sizes="128px"
            className="object-cover"
            loading="eager"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Camera className="h-12 w-12 text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>

      <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{displayName}</h1>
      <p className="mt-1 text-base text-muted-foreground">@{username}</p>

      {bio && <p className="mt-4 max-w-prose text-sm leading-relaxed sm:text-base">{bio}</p>}

      {(location || sinceYear) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
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
    </section>
  );
}
