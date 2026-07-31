import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
// The directive-free twin — this renders from a Server Component (the event
// page) as well as from a client one (the pending queue), so it must not pull
// `buttonVariants` out of the `'use client'` module (T-213).
import { buttonVariants } from '@/components/ui/button-variants';

export type PhotosEmptyStateAction = {
  href: string;
  label: string;
};

/**
 * Shared "nothing here yet" state for photo grids (T-208).
 *
 * Same visual language as the cart's empty state and `GatedFaceSearchNotice`:
 * no box, a large muted icon, a `text-2xl` title and a `text-sm` description,
 * with an optional call to action. Presentational only (no hooks), so it renders
 * from both Server Components and Client Components.
 */
export function PhotosEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: PhotosEmptyStateAction;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <Icon className="mb-6 h-16 w-16 text-muted-foreground/50" aria-hidden />
      <h3 className="text-2xl font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">{description}</p>
      {action ? (
        <Link href={action.href} className={buttonVariants()}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
