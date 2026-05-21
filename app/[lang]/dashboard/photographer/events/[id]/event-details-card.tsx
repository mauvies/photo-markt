'use client';

import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { cn } from '@/lib/utils';

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
  /**
   * Live AI indexing-status block. Rendered in the always-visible area — the
   * photographer wants the indexing progress at a glance.
   */
  aiStatus?: ReactNode;
}

type Stat = { label: string; value: ReactNode };

/**
 * "Event details" section. The at-a-glance essentials (date, location, type)
 * and the live AI indexing status stay always visible; the rest of the static
 * event configuration is tucked behind a "Show more details" expander.
 *
 * Each field is a stacked label/value pair — label above, value below — so the
 * two read as one unit instead of drifting to opposite edges of a wide row.
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
  aiStatus,
}: EventDetailsCardProps) {
  const [showMore, setShowMore] = useState(false);

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

  // Always visible — the essentials a photographer scans first.
  const primaryStats: Stat[] = [
    { label: t.date, value: date },
    { label: t.location, value: location },
    { label: t.eventType, value: typeLabel },
  ];

  // Behind the "Show more details" expander — the rest of the static config.
  const moreStats: Stat[] = [
    { label: t.activity, value: activityLabel },
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

  const renderStats = (stats: Stat[], valueClass: string): ReactNode => (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="space-y-1">
          <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {stat.label}
          </dt>
          <dd className={cn('text-sm text-foreground', valueClass)}>{stat.value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{t.title}</h2>

      <div className="mt-4">{renderStats(primaryStats, 'font-semibold')}</div>

      {aiStatus ? <div className="mt-5">{aiStatus}</div> : null}

      <Collapsible open={showMore} onOpenChange={setShowMore} className="mt-5 border-t pt-3">
        <CollapsibleTrigger
          type="button"
          className="flex w-full items-center justify-between gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {showMore ? t.showLess : t.showMore}
          <ChevronDown className={cn('h-4 w-4 transition-transform', showMore && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4">
          {renderStats(moreStats, 'font-medium')}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
