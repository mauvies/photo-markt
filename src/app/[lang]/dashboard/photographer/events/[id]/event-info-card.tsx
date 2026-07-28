'use client';

import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { cn } from '@/lib/utils';

type EventDetailsT = Dictionary['eventDetails'];

interface EventInfoCardProps {
  t: EventDetailsT;
  type: 'solo' | 'collaborative' | 'organizer';
  activityLabel: string;
  date: string;
  location: string;
  pricePerPhoto: number | null;
  isPublic: boolean;
  /** Link to the scoped info-edit page (`/edit?section=info`). */
  editHref: string;
}

type Field = { label: string; value: string };

/**
 * "Event info" card (T-179): the event's core information — date, location,
 * activity, type, price, visibility — as a responsive labelled grid. Its Edit
 * button opens the scoped info-edit page so the photographer edits only these
 * fields, not the whole event.
 */
export function EventInfoCard({
  t,
  type,
  activityLabel,
  date,
  location,
  pricePerPhoto,
  isPublic,
  editHref,
}: EventInfoCardProps) {
  const typeLabel =
    type === 'collaborative'
      ? t.typeCollaborative
      : type === 'organizer'
        ? t.typeOrganizer
        : t.typeSolo;

  const fields: Field[] = [
    { label: t.date, value: date },
    { label: t.location, value: location },
    { label: t.activity, value: activityLabel },
    { label: t.eventType, value: typeLabel },
    {
      label: t.pricePerPhoto,
      value:
        pricePerPhoto !== null ? `${PLATFORM_CURRENCY_SYMBOL}${pricePerPhoto.toFixed(2)}` : t.free,
    },
    { label: t.visibility, value: isPublic ? t.public : t.private },
  ];

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.infoTitle}</h2>
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
        {fields.map((field) => (
          <div key={field.label} className="min-w-0 space-y-0.5">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {field.label}
            </dt>
            <dd className="text-sm font-medium break-words text-foreground">{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
