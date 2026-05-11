type ProfileMetricsProps = {
  eventCount: number;
  photoCount: number;
  photosSoldCount: number;
  labels: {
    eventsCount: string;
    eventsCountOne: string;
    photosCount: string;
    photosCountOne: string;
    photosSold: string;
    photosSoldOne: string;
  };
};

function formatCount(n: number, singular: string, plural: string): string {
  return (n === 1 ? singular : plural).replace('{n}', String(n));
}

/**
 * Metrics row for the public profile. Renders up to three stat tiles in a
 * compact responsive grid. The "photos sold" tile is intentionally hidden
 * when the count is zero — surfacing "0 sold" undermines the profile.
 */
export function ProfileMetrics({
  eventCount,
  photoCount,
  photosSoldCount,
  labels,
}: ProfileMetricsProps) {
  const tiles: Array<{ value: number; label: string }> = [
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
    tiles.push({
      value: photosSoldCount,
      label: formatCount(photosSoldCount, labels.photosSoldOne, labels.photosSold),
    });
  }

  return (
    <section
      className={`grid gap-3 sm:gap-4 ${tiles.length === 3 ? 'grid-cols-3 sm:max-w-xl' : 'grid-cols-2 sm:max-w-md'}`}
    >
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex flex-col items-center rounded-xl border bg-card px-3 py-4 text-center shadow-sm sm:py-5"
        >
          <span className="text-2xl font-bold tracking-tight sm:text-3xl">{tile.value}</span>
          <span className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {tile.label.replace(/^\d+\s+/, '')}
          </span>
        </div>
      ))}
    </section>
  );
}
