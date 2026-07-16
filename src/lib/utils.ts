import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Active nav-link "pill" styling, shared so the active state looks the same
 * across dashboards. `NAV_ACTIVE_PILL` is the plain form (talent top-nav, where
 * the class is applied conditionally); `NAV_ACTIVE_PILL_DATA_ACTIVE` is the
 * `data-[active=true]` form for the photographer sidebar, whose active state is
 * driven by Shadcn's `data-active` attribute rather than a conditional class.
 */
export const NAV_ACTIVE_PILL = 'bg-accent/95 text-foreground hover:bg-accent/90';
export const NAV_ACTIVE_PILL_DATA_ACTIVE =
  'data-[active=true]:bg-accent/95 data-[active=true]:text-foreground data-[active=true]:hover:bg-accent/90';
