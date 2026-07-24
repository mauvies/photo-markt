'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { EventShareButton } from '@/components/event-share-button';
import { Button } from '@/components/ui/button';

type EventShareTabLabels = {
  heading: string;
  description: string;
  /** Extra muted note shown only for private events (link carries the access code). */
  privateNote: string;
  copy: string;
  copied: string;
  shareTooltip: string;
};

type EventShareTabProps = {
  eventName: string;
  /** Absolute, locale-prefixed public URL that actually grants access. */
  shareUrl: string;
  isPublic: boolean;
  labels: EventShareTabLabels;
};

/**
 * Share tab body (T-179): the event's real shareable URL — resolved server-side
 * to the public route that actually works (public → slug/id, private → share
 * code) — shown as selectable text, with a copy button and the shared
 * `EventShareButton` (Web Share API / clipboard). No QR here (out of scope).
 */
export function EventShareTab({ eventName, shareUrl, isPublic, labels }: EventShareTabProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className="max-w-2xl rounded-lg border bg-card p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{labels.heading}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {labels.description.replace('{eventName}', eventName)}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 select-all break-all rounded-md border border-input bg-background px-3 py-2 font-mono text-sm">
          {shareUrl}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          className="shrink-0"
          aria-label={copied ? labels.copied : labels.copy}
        >
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? labels.copied : labels.copy}
        </Button>
        <EventShareButton
          eventName={eventName}
          eventUrl={shareUrl}
          tooltip={labels.shareTooltip}
          className="shrink-0"
        />
      </div>

      {!isPublic ? (
        <p className="mt-3 text-xs text-muted-foreground">{labels.privateNote}</p>
      ) : null}
    </div>
  );
}
