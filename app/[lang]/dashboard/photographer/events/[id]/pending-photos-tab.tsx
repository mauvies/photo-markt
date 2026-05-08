'use client';

import { Check, X } from 'lucide-react';
import Image from 'next/image';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approvePendingPhotoAction, rejectPendingPhotoAction } from './actions';

type PendingPhoto = {
  id: string;
  url: string;
  uploaderLabel: string;
};

type PendingPhotosTabProps = {
  eventId: string;
  photos: PendingPhoto[];
  labels: {
    empty: string;
    approveAria: string;
    rejectAria: string;
    rejectConfirm: string;
  };
};

export function PendingPhotosTab({ eventId, photos, labels }: PendingPhotosTabProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const visible = photos.filter((p) => !removed.has(p.id));

  if (visible.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
        {labels.empty}
      </p>
    );
  }

  const handleApprove = (photoId: string) => {
    setProcessingId(photoId);
    startTransition(async () => {
      try {
        await approvePendingPhotoAction(photoId, eventId);
        setRemoved((prev) => new Set(prev).add(photoId));
      } catch (error) {
        console.error('Approve failed', error);
      } finally {
        setProcessingId(null);
      }
    });
  };

  const handleReject = (photoId: string) => {
    if (!window.confirm(labels.rejectConfirm)) return;
    setProcessingId(photoId);
    startTransition(async () => {
      try {
        await rejectPendingPhotoAction(photoId, eventId);
        setRemoved((prev) => new Set(prev).add(photoId));
      } catch (error) {
        console.error('Reject failed', error);
      } finally {
        setProcessingId(null);
      }
    });
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {visible.map((photo) => {
        const isProcessing = processingId === photo.id;
        return (
          <div
            key={photo.id}
            className="group relative aspect-square overflow-hidden rounded-lg border border-input bg-muted"
          >
            <Image
              src={photo.url}
              alt={photo.uploaderLabel}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              className="object-cover"
            />
            <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-2 text-xs text-white">
              {photo.uploaderLabel}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 p-2">
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={() => handleApprove(photo.id)}
                disabled={isProcessing}
                aria-label={labels.approveAria}
                className="h-8 w-8"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="destructive"
                onClick={() => handleReject(photo.id)}
                disabled={isProcessing}
                aria-label={labels.rejectAria}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
