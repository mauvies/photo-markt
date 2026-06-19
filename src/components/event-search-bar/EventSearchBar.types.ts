import type { SortBy } from '@/hooks/use-event-search';

export interface EventSearchBarProps {
  variant?: 'hero' | 'compact';
  initialWhere?: string;
  initialActivity?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
  initialPreset?: string;
  initialPhotographer?: string;
  initialLat?: number;
  initialLng?: number;
  initialRadius?: number;
  sortBy?: SortBy;
  onSortChange?: (sort: SortBy) => void;
  onSearch?: (where: string, activity: string, dateFrom: string, dateTo: string) => void;
  searchHref?: string;
  /**
   * Where to navigate when the user types an access code into the "where"
   * field and submits. Defaults to the public `/events` route. The talent
   * dashboard passes `/dashboard/talent/events` so authenticated talents
   * stay inside the dashboard chrome (header, nav, avatar dropdown)
   * instead of getting bounced to the public viewer.
   */
  accessCodeHref?: string;
  showMobileFilters?: boolean;
  className?: string;
}

export interface ActivityOption {
  value: string;
  label: string;
}
