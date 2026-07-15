'use client';

import { format } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import { Loader2, ShoppingCart, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import {
  type PhotoAlbumItem,
  PhotoGallery,
  type PhotoGalleryBulkAction,
  type PhotoGallerySection,
} from '@/components/photo-gallery';
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
import { useOptimisticPhotosInCart } from '@/hooks/use-optimistic-photos-in-cart';
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
  imageUnavailableLabel: string;
}

export function TalentPhotosGrid({
  initialGroups,
  hasMore: initialHasMore,
  photosInCart: initialPhotosInCart = [],
  iconTooltips,
  imageUnavailableLabel,
}: TalentPhotosGridProps) {
  const { t } = useTranslations<TalentPhotosT>();
  const params = useParams<{ lang: string }>();
  const dateLocale = params?.lang === 'es' ? es : enUS;
  const [groups, setGroups] = useState(initialGroups);
  const [offset, setOffset] = useState(
    initialGroups.reduce((sum, g) => sum + g.dates.reduce((s, d) => s + d.photos.length, 0), 0),
  );
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoading, startTransition] = useTransition();
  // Photo ids the open remove-confirmation dialog acts on.
  const [pendingRemoveIds, setPendingRemoveIds] = useState<string[]>([]);
  // Bumped to make PhotoGallery clear its selection after a bulk action.
  const [selectionResetKey, setSelectionResetKey] = useState(0);
  // Seed only once — the hook owns subsequent transitions.
  const seedPhotosInCart = useMemo(() => new Set(initialPhotosInCart), [initialPhotosInCart]);
  // No share code is threaded through the client here (T-132): a private
  // event's `share_code` is a whole-gallery bearer token, so echoing it into
  // favorites props would let one tagged photo unlock the entire event. Instead
  // `addPhotoToCartAction` proves access server-side from the talent's own tag
  // row — every photo in this grid is one they saved.
  const { photosInCart, addToCart, removeFromCart } = useOptimisticPhotosInCart({
    initialPhotosInCart: seedPhotosInCart,
    addServerAction: addPhotoToCartAction,
    removeServerAction: removePhotoFromCartAction,
    toastLabels: { failedAdd: t('failedAddCart'), failedRemove: t('failedRemoveCart') },
  });

  const handleAddSelectedToCart = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      // One optimistic transition per photo — the hook handles the icon flip +
      // badge bump; the bulk button owns only the aggregated success toast.
      for (const photoId of ids) {
        addToCart(photoId);
      }
      toast.success(`Added ${ids.length} photo${ids.length === 1 ? '' : 's'} to cart`);
      setSelectionResetKey((k) => k + 1);
    },
    [addToCart],
  );

  // Per-photo handlers fire the success toast alongside the optimistic flip
  // (the hook itself only emits on failure).
  const handleAddToCart = useCallback(
    (photoId: string) => {
      addToCart(photoId);
      toast.success(t('addedToCart'));
    },
    [addToCart, t],
  );

  const handleRemoveFromCart = useCallback(
    (photoId: string) => {
      removeFromCart(photoId);
      toast.success(t('removedFromCart'));
    },
    [removeFromCart, t],
  );

  const handleConfirmRemove = useCallback(() => {
    const idsToRemove = [...pendingRemoveIds];
    startTransition(async () => {
      try {
        await removePhotosFromMyPhotosAction(idsToRemove);
        // Optimistically remove photos from local state.
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
        setSelectionResetKey((k) => k + 1);
        toast.success(
          `Removed ${idsToRemove.length} photo${idsToRemove.length === 1 ? '' : 's'} from My Photos`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove photos';
        toast.error(message);
      }
    });
  }, [pendingRemoveIds]);

  // Restructure: group by date first, then by event.
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

    // Sort dates (newest first); 'unknown' sinks to the bottom.
    return Array.from(dateMap.entries()).sort((a, b) => {
      if (a[0] === 'unknown') return 1;
      if (b[0] === 'unknown') return -1;
      return b[0].localeCompare(a[0]);
    });
  }, [groups]);

  // One PhotoGallery section per event; the first event of each date carries
  // the sticky date header, so a single gallery spans every date/event with
  // one shared selection set + one toolbar.
  const sections = useMemo<PhotoGallerySection[]>(() => {
    const result: PhotoGallerySection[] = [];
    for (const [dateKey, events] of dateGroups) {
      const formattedDate =
        dateKey === 'unknown'
          ? t('unknownDate')
          : (() => {
              const formatted = format(new Date(dateKey), 'EEEE, MMMM d, yyyy', {
                locale: dateLocale,
              });
              return formatted.charAt(0).toUpperCase() + formatted.slice(1);
            })();

      events.forEach((event, eventIndex) => {
        const items: PhotoAlbumItem[] = event.photos
          .filter((p) => p.signed_url)
          .map((p) => ({
            id: p.photo_id,
            url: p.signed_url as string,
            alt: `Photo from ${event.event_name || 'event'}`,
          }));
        if (items.length === 0) return;

        result.push({
          key: `${dateKey}:${event.event_id ?? 'no-event'}:${eventIndex}`,
          header: (
            <div className="space-y-2">
              {eventIndex === 0 ? (
                <div className="sticky top-0 z-10 border-b border-border/50 bg-background/95 py-2 pt-4 backdrop-blur-sm">
                  <h2 className="text-xl font-semibold text-foreground">{formattedDate}</h2>
                </div>
              ) : null}
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
            </div>
          ),
          items,
        });
      });
    }
    return result;
  }, [dateGroups, dateLocale, t]);

  const galleryProps = useMemo(
    () => ({
      showAddToCart: true,
      photosInCart,
      onAddToCart: handleAddToCart,
      onRemoveFromCart: handleRemoveFromCart,
      iconTooltips,
      imageUnavailableLabel,
      lightboxActionBar: 'bottom' as const,
      actionBarLabels: {
        addToCart: t('addToCart'),
        removeFromCart: t('removeFromCart'),
      },
    }),
    [photosInCart, handleAddToCart, handleRemoveFromCart, iconTooltips, imageUnavailableLabel, t],
  );

  const bulkActions = useMemo<PhotoGalleryBulkAction[]>(
    () => [
      {
        key: 'remove',
        label: t('remove'),
        icon: Trash2,
        onRun: (ids) => setPendingRemoveIds(ids),
      },
      {
        key: 'addToCart',
        label: t('addToCart'),
        icon: ShoppingCart,
        onRun: handleAddSelectedToCart,
        isPending: isLoading,
      },
    ],
    [t, handleAddSelectedToCart, isLoading],
  );

  const selectionLabels = useMemo(
    () => ({
      select: t('select'),
      countNone: t('noPhotosSelected'),
      countOne: t('photoSelected'),
      countMany: t('photosSelected'),
      exitSelection: t('exitSelection'),
    }),
    [t],
  );

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
      <PhotoGallery
        sections={sections}
        galleryProps={galleryProps}
        bulkActions={bulkActions}
        labels={selectionLabels}
        selectionResetKey={selectionResetKey}
        toolbarClassName="sticky top-[var(--header-height)] z-30"
      />

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

      <AlertDialog
        open={pendingRemoveIds.length > 0}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveIds([]);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeFromMyPhotosTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoveIds.length === 1
                ? t('removeConfirmSingle')
                : t('removeConfirmMultiple').replace('{n}', String(pendingRemoveIds.length))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRemove}>{t('remove')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
