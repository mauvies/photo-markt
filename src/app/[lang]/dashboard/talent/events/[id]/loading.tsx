import { Skeleton } from '@/components/ui/skeleton';

// Mirrors `page.tsx`'s body (`DashboardHeader` — `h1 text-4xl font-bold` +
// actions — plus the `EventMetaLine`) and the real photo grid
// (`grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`,
// `aspect-square` tiles — matching PhotoAlbumViewer). The talent dashboard
// layout already supplies the page margins, so this only needs the body
// content, so swapping in the loaded page causes no layout shift (T-128).
export default function Loading() {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-4">
          <Skeleton className="h-10 w-64" />
          <div className="flex shrink-0 items-center gap-1">
            <Skeleton className="h-10 w-10 rounded-md" />
            <Skeleton className="h-10 w-10 rounded-md" />
          </div>
        </div>
        <Skeleton className="mt-1 h-4 w-48" />
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
