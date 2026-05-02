'use client';

import { Camera, MoreVertical } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { EventStatus } from '@/lib/event-status';

type EventCardProps = {
  id: string;
  name: string;
  date: string | null;
  city: string;
  country: string;
  activity: string;
  pricePerPhoto: number | null;
  photoCount: number;
  salesCount: number;
  isPublic: boolean;
  coverUrl?: string | null;
  status?: EventStatus;
  onDelete: () => Promise<void>;
  editHref: string;
};

export function EventCard({
  id,
  name,
  date,
  city,
  country,
  activity,
  pricePerPhoto,
  photoCount,
  salesCount,
  isPublic,
  coverUrl,
  status,
  onDelete,
  editHref,
}: EventCardProps) {
  const router = useRouter();
  const lp = useLocalizedPath();
  const [isPending] = useTransition();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const formattedDate = date ? new Date(date).toDateString().split(' ').slice(1).join(' ') : '';
  const activityLabel = activityOptions.find((opt) => opt.value === activity)?.label ?? activity;
  const location = [city, country].filter(Boolean).join(', ');
  const priceText =
    pricePerPhoto !== null
      ? `From $${pricePerPhoto % 1 === 0 ? pricePerPhoto : pricePerPhoto.toFixed(2)}`
      : 'Free';

  const handleDelete = async () => {
    await onDelete();
    router.refresh();
  };

  return (
    <div className="group relative">
      <Link href={`/dashboard/photographer/events/${id}`} className="block">
        {/* Thumbnail */}
        <div className="relative mb-3 aspect-square w-full overflow-hidden rounded-xl bg-muted">
          {coverUrl ? (
            <>
              <Image
                src={coverUrl}
                alt={`${name} cover`}
                fill
                sizes="(max-width: 640px) 100vw, 33vw"
                className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent" />
              {/* Status badge — top-left */}
              {status && (
                <span
                  className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                    status === 'upcoming'
                      ? 'bg-primary/80 text-primary-foreground'
                      : 'bg-black/50 text-white'
                  }`}
                >
                  {status === 'upcoming' ? 'Upcoming' : 'Completed'}
                </span>
              )}
              {/* Bottom overlay: photo count left, badge right */}
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-3">
                <span className="text-xs font-medium text-white drop-shadow-sm">
                  {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
                </span>
                <span
                  className={`text-[9px] font-medium uppercase tracking-wider opacity-75 ${
                    isPublic ? 'text-emerald-300' : 'text-zinc-300'
                  }`}
                >
                  {isPublic ? 'Public' : 'Private'}
                </span>
              </div>
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Camera className="h-8 w-8 opacity-30" />
              <span className="text-xs">No photos yet</span>
              {/* Status badge for no-cover state */}
              {status && (
                <span
                  className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                    status === 'upcoming'
                      ? 'bg-primary/80 text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {status === 'upcoming' ? 'Upcoming' : 'Completed'}
                </span>
              )}
              {/* Public/Private badge for no-cover state */}
              <span
                className={`absolute bottom-2 right-2 text-[9px] font-medium uppercase tracking-wider opacity-60 ${
                  isPublic ? 'text-emerald-600' : 'text-zinc-500'
                }`}
              >
                {isPublic ? 'Public' : 'Private'}
              </span>
            </div>
          )}
        </div>

        {/* Info below image */}
        <div className="flex items-start justify-between gap-3 px-1">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-snug text-foreground">{name}</p>
            {location && (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{location}</p>
            )}
            <p className="text-sm text-muted-foreground">{formattedDate}</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {activityLabel}
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              {priceText} · {salesCount} {salesCount === 1 ? 'sale' : 'sales'}
            </p>
          </div>
        </div>
      </Link>

      {/* Dropdown — top-right, visible on hover */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isPending}
            aria-label="Open event actions"
            className="pointer-events-none absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-sm transition-all group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            <MoreVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              router.push(lp(editHref));
            }}
            disabled={isPending}
          >
            Edit event
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setDeleteDialogOpen(true);
            }}
            variant="destructive"
            disabled={isPending}
          >
            Delete event
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Event"
        description="This will permanently delete the event and all its photos. This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
