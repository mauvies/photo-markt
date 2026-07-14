import { cn } from '@/lib/utils';

/**
 * Shared chrome for the sticky top header: the translucent, blurred bar and the
 * centered max-width container. Single source of truth for header height/bg/blur
 * so the public `Nav` and the dashboard headers can't drift apart.
 *
 * Pass `className` to tweak the outer `<header>` (e.g. `hidden md:block` for the
 * dashboard header that collapses into a bottom nav on mobile).
 */
export function HeaderShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/80',
        className,
      )}
    >
      <div className="mx-auto flex h-(--header-height) max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
        {children}
      </div>
    </header>
  );
}
