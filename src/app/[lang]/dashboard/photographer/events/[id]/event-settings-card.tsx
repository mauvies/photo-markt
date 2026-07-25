'use client';

import { Check, Pencil } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { cn } from '@/lib/utils';

type EventDetailsT = Dictionary['eventDetails'];

interface EventSettingsCardProps {
  t: EventDetailsT;
  /** Collaborative events get an extra "guest upload" toggle. */
  isCollaborative: boolean;
  watermarkEnabled: boolean;
  aiMatchingEnabled: boolean;
  bibDetectionEnabled: boolean;
  containsMinors: boolean;
  requireUploadApproval: boolean;
  allowGuestUpload: boolean;
  /** Link to the scoped settings-edit page (`/edit?section=settings`). */
  editHref: string;
}

type Toggle = { label: string; on: boolean };

/**
 * "Event settings" card (T-179): the event's on/off configuration — watermark,
 * AI matching, bib detection, upload approval, guest upload, minors — shown as
 * scannable badges (enabled highlighted with a check, disabled muted). Its Edit
 * button opens the scoped settings-edit page so the photographer edits only
 * these toggles, not the whole event.
 */
export function EventSettingsCard({
  t,
  isCollaborative,
  watermarkEnabled,
  aiMatchingEnabled,
  bibDetectionEnabled,
  containsMinors,
  requireUploadApproval,
  allowGuestUpload,
  editHref,
}: EventSettingsCardProps) {
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
        <h2 className="text-sm font-semibold">{t.settingsTitle}</h2>
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

      <div className="mt-4 flex flex-wrap gap-2">
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
    </section>
  );
}
