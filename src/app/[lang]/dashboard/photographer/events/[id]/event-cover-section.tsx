'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { EventCoverField, type EventCoverFieldLabels } from '@/components/event-cover-field';
import { CoverUploadError, uploadEventCover } from '@/lib/upload-event-cover';
import { removeEventCoverAction } from '../new/actions';

interface EventCoverSectionProps {
  eventId: string;
  /** Signed URL of the stored cover, or `null` when the event has none. */
  initialCoverUrl: string | null;
  fieldLabels: EventCoverFieldLabels;
  labels: {
    /** "Saved automatically" — this block does not wait for any Save button. */
    savedBadge: string;
    savedHint: string;
    /** States that the cover is presentation, not stock the photographer sells. */
    notForSaleNote: string;
    tooLarge: string;
    updateFailed: string;
  };
}

/**
 * Cover management inside the event's **Photos** tab (T-232).
 *
 * The capability shipped with T-166 and worked — it was simply unreachable from
 * the tabs a photographer actually navigates by. `details` and `pricing` open
 * the *scoped* editor, which leaves photos and cover untouched by design, and
 * the full `/edit` form (the only surface showing the cover) hung off an
 * unlabelled "⋮" dropdown next to "Delete event". Photographers concluded the
 * feature did not exist. This adds an entry point; the `/edit` one still works.
 *
 * **Photos tab rather than a fifth tab**, deliberately: T-210 already moved the
 * cover from the details step to the *photos* step of the creation wizard, so
 * this aligns managing an event with creating one. A whole tab for a single
 * control would also grow the `TabsList` that scales worst on mobile.
 *
 * **Owner-only comes for free**: a contributor never reaches the tabs at all
 * (`page.tsx` returns a minimal view before them), and `removeEventCoverAction`
 * / `attachEventCoverAction` each re-check ownership server-side regardless.
 *
 * Persistence reuses the existing actions untouched — no new action, no
 * migration — so cache invalidation (event cards, `og:image`) is whatever the
 * `/edit` form already got. Same optimistic pattern too: show the picked file
 * immediately, roll the preview back and toast if the write fails.
 */
export function EventCoverSection({
  eventId,
  initialCoverUrl,
  fieldLabels,
  labels,
}: EventCoverSectionProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialCoverUrl);
  const [isPending, startTransition] = useTransition();

  const handleCoverChange = (file: File | null) => {
    const prior = previewUrl;

    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
      startTransition(async () => {
        try {
          // Direct-to-Storage (T-238) — the bytes never cross a Server Action,
          // so Vercel's 4.5 MB body cap is not in play.
          await uploadEventCover(eventId, file);
          if (prior?.startsWith('blob:')) URL.revokeObjectURL(prior);
        } catch (error) {
          console.error(error);
          URL.revokeObjectURL(objectUrl);
          setPreviewUrl(prior);
          toast.error(
            error instanceof CoverUploadError && error.code === 'too-large'
              ? labels.tooLarge
              : labels.updateFailed,
          );
        }
      });
      return;
    }

    setPreviewUrl(null);
    startTransition(async () => {
      try {
        await removeEventCoverAction(eventId);
        if (prior?.startsWith('blob:')) URL.revokeObjectURL(prior);
      } catch (error) {
        console.error(error);
        setPreviewUrl(prior);
        toast.error(labels.updateFailed);
      }
    });
  };

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-start">
        <EventCoverField
          previewUrl={previewUrl}
          onCoverChange={handleCoverChange}
          busy={isPending}
          // Distinct from the edit form's id: both can be mounted in one session.
          inputId="event-tab-cover-image"
          labels={fieldLabels}
        />
        <div className="space-y-2 text-xs text-muted-foreground sm:pt-7">
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {labels.savedBadge}
          </span>
          <p>{labels.savedHint}</p>
          {/* The grid below this block is the photos the photographer sells;
              the cover is not one of them and has no `photos` row at all. */}
          <p>{labels.notForSaleNote}</p>
        </div>
      </div>
    </section>
  );
}
