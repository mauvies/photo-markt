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
  showMobileFilters?: boolean;
  className?: string;
}

export interface ActivityOption {
  value: string;
  label: string;
}
