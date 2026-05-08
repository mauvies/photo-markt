'use client';

import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import { Loader2, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { addPhotoToCartAction } from '@/app/[lang]/dashboard/talent/cart/actions';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoIconTooltips } from '@/components/photo-icon-buttons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import {
  listMyTaggedPhotos,
  removePhotosFromMyPhotosAction,
  type TaggedPhotoGroup,
} from './actions';

type TalentPhotosT = Dictionary['talentPhotos'] & { cancel: string };

interface TalentPhotosGridProps {
  initialGroups: TaggedPhotoGroup[];
  hasMore: boolean;
  photosInCart?: string[];
  iconTooltips?: Partial<PhotoIconTooltips>;
}

export function TalentPhotosGrid({
  initialGroups,
  hasMore: initialHasMore,
  photosInCart = [],
  iconTooltips,
}: TalentPhotosGridProps) {
  const { t } = useTranslations<TalentPhotosT>();
  const params = useParams<{ lang: string }>();
  const dateLocale = params?.lang === 'es' ? es : enUS;
  const queryClient = useQueryClient();
  const [groups, setGroups] = useState(initialGroups);
  const [offset, setOffset] = useState(
    initialGroups.reduce((sum, g) => sum + g.dates.reduce((s, d) => s + d.photos.length, 0), 0),
  );
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoading, startTransition] = useTransition();
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  const handleToggleSelect = useCallback((photoId: string) => {
    setSelectedIds((current) => {
      const exists = current.includes(photoId);
      const next = exists ? current.filter((id) => id !== photoId) : [...current, photoId];
      setIsSelecting(next.length > 0);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setIsSelecting(false);
  }, []);

  const handleAddSelectedToCart = useCallback(() => {
    if (selectedIds.length === 0) return;
    startTransition(async () => {
      try {
        for (const photoId of selectedIds) {
          await addPhotoToCartAction(photoId);
        }
        queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        toast.success(
          `Added ${selectedIds.length} photo${selectedIds.length === 1 ? '' : 's'} to cart`,
        );
        setSelectedIds([]);
        setIsSelecting(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to add photos to cart';
        toast.error(message);
      }
    });
  }, [selectedIds, queryClient]);

  const handleConfirmRemove = useCallback(() => {
    const idsToRemove = [...selectedIds];
    startTransition(async () => {
      try {
        await removePhotosFromMyPhotosAction(idsToRemove);
        // Optimistically remove photos from local state
        setGroups((prev) =>
          prev
            .map((group) => ({
              ...group,
              dates: group.dates
                .map((d) => ({
                  ...d,
                  photos: d.photos.filter((p) => !idsToRemove.includes(p.photo_id)),
                }))
                .filter((d) => d.photos.length > 0),
            }))
            .filter((g) => g.dates.length > 0),
        );
        setSelectedIds([]);
        setIsSelecting(false);
        toast.success(
          `Removed ${idsToRemove.length} photo${idsToRemove.length === 1 ? '' : 's'} from My Photos`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove photos';
        toast.error(message);
      }
    });
  }, [selectedIds]);

  const selectedCountLabel = useMemo(() => {
    if (selectedIds.length === 0) return t('noPhotosSelected');
    if (selectedIds.length === 1) return t('photoSelected');
    return t('photosSelected').replace('{n}', String(selectedIds.length));
  }, [selectedIds.length, t]);

  // Restructure: Group by date first, then by event
  const dateGroups = useMemo(() => {
    const dateMap = new Map<
      string,
      Array<{
        event_id: string | null;
        event_name: string | null;
        event_date: string | null;
        event_city: string | null;
        event_country: string | null;
        event_watermark_enabled: boolean | null;
        photos: Array<{
          photo_id: string;
          photo_url: string;
          signed_url: string | null;
          taken_at: string | null;
          tagged_at: string;
        }>;
      }>
    >();

    // Flatten and regroup by date first
    for (const group of groups) {
      for (const dateGroup of group.dates) {
        const dateKey = dateGroup.date;
        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, []);
        }

        const dateEvents = dateMap.get(dateKey);
        if (!dateEvents) continue;
        let eventGroup = dateEvents.find((e) => e.event_id === group.event_id);

        if (!eventGroup) {
          eventGroup = {
            event_id: group.event_id,
            event_name: group.event_name,
            event_date: group.event_date,
            event_city: group.event_city,
            event_country: group.event_country,
            event_watermark_enabled: group.event_watermark_enabled,
            photos: [],
          };
          dateEvents.push(eventGroup);
        }

        eventGroup.photos.push(...dateGroup.photos);
      }
    }

    // Sort dates (newest first)
    const sortedDates = Array.from(dateMap.entries()).sort((a, b) => {
      if (a[0] === 'unknown') return 1;
      if (b[0] === 'unknown') return -1;
      return b[0].localeCompare(a[0]);
    });

    return sortedDates;
  }, [groups]);

  // Convert all photos to flat PhotoAlbumItem array
  const photoItems = useMemo(() => {
    const items: PhotoAlbumItem[] = [];
    for (const [, events] of dateGroups) {
      for (const event of events) {
        for (const photo of event.photos) {
          if (photo.signed_url) {
            items.push({
              id: photo.photo_id,
              url: photo.signed_url,
              alt: `Photo from ${event.event_name || 'event'}`,
            });
          }
        }
      }
    }
    return items;
  }, [dateGroups]);

  const handleLoadMore = () => {
    startTransition(async () => {
      try {
        const result = await listMyTaggedPhotos({ limit: 50, offset });
        setGroups((prev) => [...prev, ...result.groups]);
        setOffset(
          (prev) =>
            prev +
            result.groups.reduce(
              (sum, g) => sum + g.dates.reduce((s, d) => s + d.photos.length, 0),
              0,
            ),
        );
        setHasMore(result.hasMore);
      } catch (error) {
        console.error('Failed to load more photos:', error);
      }
    });
  };

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center">
        <p className="text-muted-foreground">{t('noPhotosTagged')}</p>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="mt-4 flex justify-end items-center gap-3">
        {isSelecting ? (
          <>
            <div className="text-sm font-medium text-muted-foreground">{selectedCountLabel}</div>
            <Button type="button" variant="outline" size="sm" onClick={clearSelection}>
              {t('clear')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowRemoveConfirm(true)}
              disabled={selectedIds.length === 0 || isLoading}
            >
              {t('remove')}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleAddSelectedToCart}
              disabled={selectedIds.length === 0 || isLoading}
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              {t('addToCart')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setIsSelecting(true)}>
            {t('select')}
          </Button>
        )}
      </div>

      <div className="space-y-6">
        {/* Grouped by date, then event */}
        {dateGroups.map(([dateKey, events]) => (
          <div key={dateKey} className="space-y-2">
            {/* Date Header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 pt-4 border-b border-border/50">
              <h2 className="text-xl font-semibold text-foreground">
                {dateKey === 'unknown'
                  ? t('unknownDate')
                  : (() => {
                      const formatted = format(new Date(dateKey), 'EEEE, MMMM d, yyyy', {
                        locale: dateLocale,
                      });
                      return formatted.charAt(0).toUpperCase() + formatted.slice(1);
                    })()}
              </h2>
            </div>

            {/* Events within this date */}
            {events.map((event) => (
              <div key={event.event_id ?? `no-event-${dateKey}`} className="space-y-3">
                {/* Event Info */}
                <div className="flex flex-wrap items-baseline gap-1.5">
                  {event.event_id ? (
                    <Link
                      href={`/dashboard/talent/events/${event.event_id}`}
                      className="text-sm font-semibold text-foreground hover:underline"
                    >
                      {event.event_name ?? t('uncategorized')}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-foreground">
                      {event.event_name ?? t('uncategorized')}
                    </span>
                  )}
                  {event.event_city && event.event_country && (
                    <>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-sm text-muted-foreground">
                        {event.event_city}, {event.event_country}
                      </span>
                    </>
                  )}
                </div>

                {/* Photos for this event */}
                <div className="max-w-full">
                  <PhotoAlbumViewer
                    items={photoItems.filter((item) =>
                      event.photos.some((p) => p.photo_id === item.id),
                    )}
                    selectionMode={isSelecting}
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                    showAddToCart={true}
                    photosInCart={new Set(photosInCart)}
                    iconTooltips={iconTooltips}
                  />
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* Load More Button */}
        {hasMore && (
          <div className="flex justify-center pt-8">
            <Button onClick={handleLoadMore} disabled={isLoading} variant="outline">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('loading')}
                </>
              ) : (
                t('loadMore')
              )}
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeFromMyPhotosTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedIds.length === 1
                ? t('removeConfirmSingle')
                : t('removeConfirmMultiple').replace('{n}', String(selectedIds.length))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
