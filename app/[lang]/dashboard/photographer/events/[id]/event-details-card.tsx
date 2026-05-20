import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import type { Dictionary } from '@/lib/i18n/get-dictionary';

type EventDetailsT = Dictionary['eventDetails'];

interface EventDetailsCardProps {
  t: EventDetailsT;
  type: 'solo' | 'collaborative' | 'organizer';
  /** Collaborative events get an extra "guest upload" row. */
  isCollaborative: boolean;
  activityLabel: string;
  date: string;
  location: string;
  pricePerPhoto: number | null;
  isPublic: boolean;
  watermarkEnabled: boolean;
  aiMatchingEnabled: boolean;
  containsMinors: boolean;
  requireUploadApproval: boolean;
  allowGuestUpload: boolean;
}

/**
 * Full-width summary of every configuration field set when the event was
 * created — surfaces settings the rest of the page never showed. Read-only;
 * all values come from the `event` row already fetched by the page.
 */
export function EventDetailsCard({
  t,
  type,
  isCollaborative,
  activityLabel,
  date,
  location,
  pricePerPhoto,
  isPublic,
  watermarkEnabled,
  aiMatchingEnabled,
  containsMinors,
  requireUploadApproval,
  allowGuestUpload,
}: EventDetailsCardProps) {
  const typeLabel =
    type === 'collaborative'
      ? t.typeCollaborative
      : type === 'organizer'
        ? t.typeOrganizer
        : t.typeSolo;

  // Booleans render as a badge — never raw true/false. Filled badge = "on".
  const boolBadge = (on: boolean, onLabel: string, offLabel: string): ReactNode => (
    <Badge variant={on ? 'secondary' : 'outline'} className="font-normal">
      {on ? onLabel : offLabel}
    </Badge>
  );

  const rows: Array<{ label: string; value: ReactNode }> = [
    { label: t.eventType, value: typeLabel },
    { label: t.activity, value: activityLabel },
    { label: t.date, value: date },
    { label: t.location, value: location },
    {
      label: t.pricePerPhoto,
      value: pricePerPhoto !== null ? `$${pricePerPhoto.toFixed(2)}` : t.free,
    },
    { label: t.visibility, value: isPublic ? t.public : t.private },
    { label: t.watermark, value: boolBadge(watermarkEnabled, t.enabled, t.disabled) },
    { label: t.aiMatching, value: boolBadge(aiMatchingEnabled, t.enabled, t.disabled) },
    { label: t.containsMinors, value: boolBadge(containsMinors, t.yes, t.no) },
    { label: t.uploadApproval, value: boolBadge(requireUploadApproval, t.yes, t.no) },
    ...(isCollaborative
      ? [{ label: t.guestUpload, value: boolBadge(allowGuestUpload, t.yes, t.no) }]
      : []),
  ];

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">{t.title}</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="text-right text-sm font-medium text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
