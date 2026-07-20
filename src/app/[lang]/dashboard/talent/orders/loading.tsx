import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton for the orders page. Shape mirrors the real layout (3 stat cards
 * + a stack of order cards with stacked thumbnails) so nothing reflows when
 * the real data lands.
 */
export default function OrdersLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <Skeleton className="h-8 w-32" />

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items, count never changes
          <Card key={`stat-${i + 1}`}>
            <CardContent className="flex flex-col gap-2 p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-4 rounded" />
              </div>
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items, count never changes
          <Card key={`order-${i + 1}`} className="p-0">
            <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
              <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-9 w-full sm:w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
