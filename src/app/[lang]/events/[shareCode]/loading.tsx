import { Skeleton } from '@/components/ui/skeleton';

// Mirrors `page.tsx`'s shell (`mx-auto max-w-[1300px] w-full flex-1 px-3
// py-4 sm:py-10 sm:px-6 lg:px-8`), header row (title + meta line + share
// button), and the real photo grid (`grid-cols-2 gap-2 sm:grid-cols-3
// md:grid-cols-4 lg:grid-cols-5`, `aspect-square` tiles — matching
// PhotoAlbumViewer) so swapping in the loaded page causes no layout
// shift (T-128).
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1300px] w-full flex-1 px-3 py-4 sm:py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 15 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items, count never changes
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    </div>
  );
}
