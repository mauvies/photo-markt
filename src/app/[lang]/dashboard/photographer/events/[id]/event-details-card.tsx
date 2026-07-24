'use client';

import { Check, Pencil } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { cn } from '@/lib/utils';

type EventDetailsT = Dictionary['eventDetails'];

interface EventDetailsCardProps {
  t: EventDetailsT;
  type: 'solo' | 'collaborative' | 'organizer';
  /** Collaborative events get an extra "guest upload" toggle. */
  isCollaborative: boolean;
  activityLabel: string;
  date: string;
  location: string;
  pricePerPhoto: number | null;
  isPublic: boolean;
  watermarkEnabled: boolean;
  aiMatchingEnabled: boolean;
  bibDetectionEnabled: boolean;
  containsMinors: boolean;
  requireUploadApproval: boolean;
  allowGuestUpload: boolean;
  /** Link to the event's edit page. */
  editHref: string;
}

type Field = { label: string; value: string };
type Toggle = { label: string; on: boolean };

/**
 * "Event details" card. The core information (date, location, activity, type,
 * price, visibility) reads as a responsive labelled grid; the on/off
 * configuration (watermark, AI matching, bib detection, upload approval, guest
 * upload, minors) shows as a row of badges — enabled ones highlighted with a
 * check, disabled ones muted — so the whole event configuration is scannable at
 * a glance without a "show more" expander. An "Edit" link opens the edit page.
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
  bibDetectionEnabled,
  containsMinors,
  requireUploadApproval,
  allowGuestUpload,
  editHref,
}: EventDetailsCardProps) {
  const typeLabel =
    type === 'collaborative'
      ? t.typeCollaborative
      : type === 'organizer'
        ? t.typeOrganizer
        : t.typeSolo;

  const infoFields: Field[] = [
    { label: t.date, value: date },
    { label: t.location, value: location },
    { label: t.activity, value: activityLabel },
    { label: t.eventType, value: typeLabel },
    {
      label: t.pricePerPhoto,
      value: pricePerPhoto !== null ? `$${pricePerPhoto.toFixed(2)}` : t.free,
    },
    { label: t.visibility, value: isPublic ? t.public : t.private },
  ];

  const toggles: Toggle[] = [
    { label: t.watermark, on: watermarkEnabled },
    { label: t.aiMatching, on: aiMatchingEnabled },
    { label: t.bibDetection, on: bibDetectionEnabled },
    { label: t.uploadApproval, on: requireUploadApproval },
    ...(isCollaborative ? [{ label: t.guestUpload, on: allowGuestUpload }] : []),
    { label: t.containsMinors, on: containsMinors },
  ];

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.title}</h2>
        <Link
          href={editHref}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            '-mr-2 text-muted-foreground',
          )}
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {t.edit}
        </Link>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {infoFields.map((field) => (
          <div key={field.label} className="min-w-0 space-y-0.5">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {field.label}
            </dt>
            <dd className="text-sm font-medium break-words text-foreground">{field.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 border-t pt-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t.settings}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {toggles.map((toggle) => (
            <Badge
              key={toggle.label}
              variant={toggle.on ? 'secondary' : 'outline'}
              className={cn('gap-1 font-normal', !toggle.on && 'text-muted-foreground')}
            >
              {toggle.on ? <Check className="h-3 w-3" /> : null}
              {toggle.label}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}
