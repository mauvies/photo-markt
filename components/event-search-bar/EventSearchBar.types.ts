export interface EventSearchBarProps {
  variant?: 'hero' | 'compact';
  initialWhere?: string;
  initialActivity?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
  initialPreset?: string;
  initialLat?: number;
  initialLng?: number;
  initialRadius?: number;
  onSearch?: (where: string, activity: string, dateFrom: string, dateTo: string) => void;
  searchHref?: string;
  className?: string;
}

export interface ActivityOption {
  value: string;
  label: string;
}
