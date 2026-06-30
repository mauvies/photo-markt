'use client';

import { ChevronDown, Pencil } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
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
  /** Link to the event's edit page. */
  editHref: string;
}

type Field = { label: string; value: string };

/**
 * "Event details" section. The essentials (date, location, type) stay always
 * visible; the rest of the static configuration sits behind a "Show more
 * details" expander. Every field renders identically — an uppercase
 * micro-label above a plain-text value — so the column reads as one uniform
 * list. An "Edit" link in the header opens the event's edit page.
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
  editHref,
}: EventDetailsCardProps) {
  const [showMore, setShowMore] = useState(false);

  const typeLabel =
    type === 'collaborative'
      ? t.typeCollaborative
      : type === 'organizer'
        ? t.typeOrganizer
        : t.typeSolo;

  const yesNo = (on: boolean): string => (on ? t.yes : t.no);

  // Always visible — the essentials a photographer scans first.
  const primaryFields: Field[] = [
    { label: t.date, value: date },
    { label: t.location, value: location },
    { label: t.eventType, value: typeLabel },
  ];

  // Behind the "Show more details" expander. Every value is plain text — no
  // mix of badges and text — so the whole column stays visually uniform.
  const moreFields: Field[] = [
    { label: t.activity, value: activityLabel },
    {
      label: t.pricePerPhoto,
      value: pricePerPhoto !== null ? `$${pricePerPhoto.toFixed(2)}` : t.free,
    },
    { label: t.visibility, value: isPublic ? t.public : t.private },
    { label: t.watermark, value: yesNo(watermarkEnabled) },
    { label: t.aiMatching, value: yesNo(aiMatchingEnabled) },
    { label: t.containsMinors, value: yesNo(containsMinors) },
    { label: t.uploadApproval, value: yesNo(requireUploadApproval) },
    ...(isCollaborative ? [{ label: t.guestUpload, value: yesNo(allowGuestUpload) }] : []),
  ];

  const renderFields = (fields: Field[]): ReactNode => (
    <dl className="space-y-3">
      {fields.map((field) => (
        <div key={field.label} className="space-y-0.5">
          <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {field.label}
          </dt>
          <dd className="text-sm font-medium text-foreground">{field.value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.title}</h2>
        <Link
          href={editHref}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            '-mr-2 text-muted-foreground',
          )}
        >
          <Pencil className="h-3.5 w-3.5 mr-1" />
          {t.edit}
        </Link>
      </div>

      <div className="mt-4">{renderFields(primaryFields)}</div>

      <Collapsible open={showMore} onOpenChange={setShowMore} className="mt-4 border-t pt-3">
        <CollapsibleTrigger
          type="button"
          className="flex w-full items-center justify-between gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {showMore ? t.showLess : t.showMore}
          <ChevronDown className={cn('h-4 w-4 transition-transform', showMore && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">{renderFields(moreFields)}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}
