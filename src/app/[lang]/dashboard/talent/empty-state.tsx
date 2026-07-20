'use client';

import { Camera, Compass } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { cn } from '@/lib/utils';

export function EmptyState() {
  const lp = useLocalizedPath();
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Camera className="h-12 w-12 text-muted-foreground/50 mb-4" />
      <p className="text-base font-medium text-muted-foreground md:text-sm">No photos added yet</p>
      <p className="mt-1 text-sm text-muted-foreground md:text-xs">
        Photos where you&apos;re tagged will appear here
      </p>
      <Link
        href={lp('/dashboard/talent/events')}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-4')}
      >
        <Compass className="mr-2 h-4 w-4" />
        Explore Events
      </Link>
    </div>
  );
}
