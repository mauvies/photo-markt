'use client';

import { X } from 'lucide-react';
import Image from 'next/image';
import type { DisplayPhoto } from '../edit-event-schema';

type EventPhotoGridProps = {
  visiblePhotos: DisplayPhoto[];
  pendingDeletions: Set<string>;
  newFiles: File[];
  onDeletePhoto: (id: string) => void;
  onRemoveFile: (file: File) => void;
};

export function EventPhotoGrid({
  visiblePhotos,
  pendingDeletions,
  newFiles,
  onDeletePhoto,
  onRemoveFile,
}: EventPhotoGridProps) {
  if (visiblePhotos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No photos yet. Add photos using the upload area above.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {visiblePhotos.map((photo) => {
        const isPending = 'isPending' in photo && photo.isPending;
        const isDeleted = !isPending && pendingDeletions.has(photo.id);
        if (isDeleted) return null;

        return (
          <div key={photo.id} className="group relative aspect-square overflow-visible rounded-lg">
            <div
              className={`absolute inset-0 overflow-hidden rounded-lg border bg-muted ${
                isPending ? 'border-dashed border-primary/50' : ''
              }`}
            >
              {photo.url ? (
                <Image
                  src={photo.url}
                  alt={isPending ? 'Pending photo' : 'Event photo'}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  No preview
                </div>
              )}
            </div>
            {!isPending && (
              <button
                type="button"
                onClick={() => onDeletePhoto(photo.id)}
                className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/80 text-gray-300 shadow-sm opacity-0 transition-opacity hover:bg-foreground group-hover:opacity-100"
                aria-label="Delete photo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {isPending && (
              <button
                type="button"
                onClick={() => {
                  const file = newFiles.find(
                    (f) => `pending-${f.name}-${f.lastModified}` === photo.id,
                  );
                  if (file) onRemoveFile(file);
                }}
                className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/80 text-gray-300 shadow-sm opacity-0 transition-opacity hover:bg-foreground group-hover:opacity-100"
                aria-label="Remove pending photo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
