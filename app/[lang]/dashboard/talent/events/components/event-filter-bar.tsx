'use client';

import { format, parseISO } from 'date-fns';
import { CalendarIcon, ChevronDown, Filter, MapPin, Search, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FilterOptions, SortBy } from '@/hooks/use-event-search';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';

type ActivityOption = { value: string; label: string };

type EventFilterBarT = Dictionary['eventFilterBar'];

type EventFilterBarProps = {
  // Mode
  hideTopFilters: boolean;
  // Text search (full mode only)
  searchText: string;
  setSearchText: (v: string) => void;
  triggerSearch: () => void;
  // Filters
  selectedActivity: string;
  setSelectedActivity: (v: string) => void;
  selectedCity: string;
  setSelectedCity: (v: string) => void;
  selectedCountry: string;
  setSelectedCountry: (v: string) => void;
  sortBy: SortBy;
  setSortBy: (v: SortBy) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  // Options
  filterOptions: FilterOptions;
  sortedActivityOptions: ActivityOption[];
  // Computed
  locationLabel: string | null;
  hasFilters: boolean;
  activeFilterCount: number;
  dateFilterCount: number;
  // Modal
  isFilterModalOpen: boolean;
  setIsFilterModalOpen: (v: boolean) => void;
  // Photographer filter
  photographerQuery: string;
  setPhotographerQuery: (v: string) => void;
  // Radius
  radiusKm: number;
  setRadiusKm: (v: number) => void;
  // Actions
  handleFilterChange: (setter: (v: string) => void) => (value: string) => void;
  clearFilters: () => void;
  setHasSearched: (v: boolean) => void;
  // Extra buttons (e.g. Find Me) rendered before the Filters button
  extraButtons?: React.ReactNode;
  // Content rendered on the left side (only in hideTopFilters mode)
  leftSlot?: React.ReactNode;
};

function parseDateStr(s: string): Date | undefined {
  if (!s) return undefined;
  try {
    return parseISO(s);
  } catch {
    return undefined;
  }
}

function dateRangeLabel(from: string, to: string): string {
  const f = parseDateStr(from);
  const t = parseDateStr(to);
  if (f && t) return `${format(f, 'MMM d')} – ${format(t, 'MMM d')}`;
  if (f) return `From ${format(f, 'MMM d')}`;
  if (t) return `Until ${format(t, 'MMM d')}`;
  return 'Pick dates';
}

export function EventFilterBar({
  hideTopFilters,
  searchText,
  setSearchText,
  triggerSearch,
  selectedActivity,
  setSelectedActivity,
  selectedCity,
  setSelectedCity,
  selectedCountry,
  setSelectedCountry,
  sortBy,
  setSortBy,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  filterOptions,
  sortedActivityOptions,
  locationLabel,
  hasFilters,
  activeFilterCount,
  dateFilterCount,
  isFilterModalOpen,
  setIsFilterModalOpen,
  handleFilterChange,
  clearFilters,
  setHasSearched,
  extraButtons,
  leftSlot,
  photographerQuery,
  setPhotographerQuery,
  radiusKm,
  setRadiusKm,
}: EventFilterBarProps) {
  const { t } = useTranslations<EventFilterBarT>();
  // --- Local (pending) state for the modal ---
  const [localActivity, setLocalActivity] = useState(selectedActivity);
  const [localCity, setLocalCity] = useState(selectedCity);
  const [localCountry, setLocalCountry] = useState(selectedCountry);
  const [localSortBy, setLocalSortBy] = useState<SortBy>(sortBy);
  const [localPhotographerQuery, setLocalPhotographerQuery] = useState(photographerQuery);
  const [localDateRange, setLocalDateRange] = useState<DateRange | undefined>(() => {
    const from = parseDateStr(dateFrom);
    const to = parseDateStr(dateTo);
    return from || to ? { from, to } : undefined;
  });
  // Sync local state when modal opens so it always reflects current applied state
  // biome-ignore lint/correctness/useExhaustiveDependencies: only sync on open
  useEffect(() => {
    if (!isFilterModalOpen) return;
    setLocalActivity(selectedActivity);
    setLocalCity(selectedCity);
    setLocalCountry(selectedCountry);
    setLocalSortBy(sortBy);
    setLocalPhotographerQuery(photographerQuery);
    const from = parseDateStr(dateFrom);
    const to = parseDateStr(dateTo);
    setLocalDateRange(from || to ? { from, to } : undefined);
  }, [isFilterModalOpen]);

  const applyModalFilters = () => {
    setSelectedActivity(localActivity);
    setSelectedCity(localCity);
    setSelectedCountry(localCountry);
    setSortBy(localSortBy);
    setPhotographerQuery(localPhotographerQuery);
    setDateFrom(localDateRange?.from ? format(localDateRange.from, 'yyyy-MM-dd') : '');
    setDateTo(localDateRange?.to ? format(localDateRange.to, 'yyyy-MM-dd') : '');
    setHasSearched(true);
    setIsFilterModalOpen(false);
  };

  const hasLocalFilters =
    localActivity !== 'all' ||
    localCity !== 'all' ||
    localCountry !== 'all' ||
    !!localDateRange?.from ||
    !!localDateRange?.to ||
    !!localPhotographerQuery;

  const resetLocalFilters = () => {
    setLocalActivity('all');
    setLocalCity('all');
    setLocalCountry('all');
    setLocalSortBy('date_desc');
    setLocalPhotographerQuery('');
    setLocalDateRange(undefined);
  };

  // --- Desktop inline "When" date picker state ---
  const [whenPopoverOpen, setWhenPopoverOpen] = useState(false);
  const [radiusPopoverOpen, setRadiusPopoverOpen] = useState(false);
  const [inlineRange, setInlineRange] = useState<DateRange | undefined>(() => {
    const from = parseDateStr(dateFrom);
    const to = parseDateStr(dateTo);
    return from || to ? { from, to } : undefined;
  });

  // Keep inline range in sync when filters are cleared externally
  useEffect(() => {
    const from = parseDateStr(dateFrom);
    const to = parseDateStr(dateTo);
    setInlineRange(from || to ? { from, to } : undefined);
  }, [dateFrom, dateTo]);

  const applyInlineRange = (range: DateRange | undefined) => {
    setInlineRange(range);
    setDateFrom(range?.from ? format(range.from, 'yyyy-MM-dd') : '');
    setDateTo(range?.to ? format(range.to, 'yyyy-MM-dd') : '');
    setHasSearched(true);
    if (range?.from && range.to) setWhenPopoverOpen(false);
  };

  // --- Shared modal content ---
  const photographerField = (value: string, onChange: (v: string) => void) => (
    <div className="w-full">
      <Label className="mb-2 block text-sm font-medium">Photographer</Label>
      <div className="relative">
        <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search by username..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-9 pr-9"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );

  const whenField = (
    range: DateRange | undefined,
    onChange: (r: DateRange | undefined) => void,
  ) => (
    <div className="w-full">
      <Label className="mb-2 block text-sm font-medium">When</Label>
      <Calendar
        mode="range"
        selected={range}
        onSelect={onChange}
        numberOfMonths={1}
        className="rounded-md border"
      />
      {(range?.from || range?.to) && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear dates
        </button>
      )}
    </div>
  );

  const RADIUS_OPTIONS = [
    { label: '5 km', value: 5 },
    { label: '10 km', value: 10 },
    { label: '25 km', value: 25 },
    { label: '50 km', value: 50 },
    { label: '100 km', value: 100 },
    { label: 'National', value: 0 },
  ] as const;

  const simplifiedModalContent = (
    <div className="space-y-4 py-4">
      {photographerField(localPhotographerQuery, setLocalPhotographerQuery)}
    </div>
  );

  const fullModalContent = (
    <div className="space-y-4 py-4">
      {photographerField(localPhotographerQuery, setLocalPhotographerQuery)}

      <div className="w-full">
        <Label htmlFor="activity-filter-modal" className="mb-2 block text-sm font-medium">
          Activity
        </Label>
        <Select value={localActivity} onValueChange={setLocalActivity}>
          <SelectTrigger id="activity-filter-modal" className="w-full">
            <SelectValue placeholder="All activities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All activities</SelectItem>
            {sortedActivityOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-full">
        <Label htmlFor="city-filter-modal" className="mb-2 block text-sm font-medium">
          City
        </Label>
        <Select value={localCity} onValueChange={setLocalCity}>
          <SelectTrigger id="city-filter-modal" className="w-full">
            <SelectValue placeholder="All cities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cities</SelectItem>
            {filterOptions.cities.map((city) => (
              <SelectItem key={city} value={city}>
                {city}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-full">
        <Label htmlFor="country-filter-modal" className="mb-2 block text-sm font-medium">
          Country
        </Label>
        <Select value={localCountry} onValueChange={setLocalCountry}>
          <SelectTrigger id="country-filter-modal" className="w-full">
            <SelectValue placeholder="All countries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All countries</SelectItem>
            {filterOptions.countries.map((country) => (
              <SelectItem key={country} value={country}>
                {country}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-full">
        <Label htmlFor="sort-filter-modal" className="mb-2 block text-sm font-medium">
          {t('sortBy')}
        </Label>
        <Select value={localSortBy} onValueChange={(v) => setLocalSortBy(v as SortBy)}>
          <SelectTrigger id="sort-filter-modal" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date_desc">{t('newestFirst')}</SelectItem>
            <SelectItem value="date_asc">{t('oldestFirst')}</SelectItem>
            <SelectItem value="name_asc">{t('nameAZ')}</SelectItem>
            <SelectItem value="name_desc">{t('nameZA')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {whenField(localDateRange, setLocalDateRange)}
    </div>
  );

  const modalFooter = (
    <DialogFooter className="flex-col gap-2 sm:flex-row">
      {hasLocalFilters && (
        <Button
          type="button"
          variant="ghost"
          onClick={resetLocalFilters}
          className="w-full sm:w-auto"
        >
          {t('clearAll')}
        </Button>
      )}
      <Button type="button" onClick={applyModalFilters} className="w-full sm:w-auto">
        {t('applyFilters')}
      </Button>
    </DialogFooter>
  );

  if (hideTopFilters) {
    return (
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {leftSlot}
          {locationLabel ? (
            <>
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm text-muted-foreground">
                {t('showingEventsNear')}{' '}
                <span className="font-medium text-foreground">{locationLabel}</span>
                {radiusKm > 0 && (
                  <Popover open={radiusPopoverOpen} onOpenChange={setRadiusPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="ml-1 inline-flex items-center gap-0.5 rounded text-muted-foreground transition-colors hover:text-foreground"
                      >
                        · {t('withinKm').replace('{n}', String(radiusKm))}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" align="start">
                      <div className="flex flex-col gap-1.5">
                        {RADIUS_OPTIONS.map(({ label, value }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              setRadiusKm(value);
                              setHasSearched(true);
                              setRadiusPopoverOpen(false);
                            }}
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-left text-sm font-medium transition-colors',
                              radiusKm === value
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background text-foreground hover:bg-muted',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {extraButtons}
          <Dialog open={isFilterModalOpen} onOpenChange={setIsFilterModalOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Filter className="h-4 w-4" />
                {t('filters')}
                {dateFilterCount > 0 && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                    {dateFilterCount}
                  </span>
                )}
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t('filterTitle')}</DialogTitle>
              </DialogHeader>
              {simplifiedModalContent}
              {modalFooter}
            </DialogContent>
          </Dialog>

          <Select
            value={sortBy}
            onValueChange={(value) => {
              setSortBy(value as SortBy);
              setHasSearched(true);
            }}
          >
            <SelectTrigger className="h-9 w-auto rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">{t('newestFirst')}</SelectItem>
              <SelectItem value="date_asc">{t('oldestFirst')}</SelectItem>
              <SelectItem value="name_asc">{t('nameAZ')}</SelectItem>
              <SelectItem value="name_desc">{t('nameZA')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      {/* Text search */}
      <div className="relative flex min-w-0 flex-1 gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search events by name, city, or country..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (searchText.trim() || hasFilters)) {
                triggerSearch();
              }
            }}
            className="pl-9 pr-9"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button
          type="button"
          disabled={searchText.trim() === '' && !hasFilters}
          onClick={triggerSearch}
          className="shrink-0"
        >
          <Search className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{t('searchButton')}</span>
        </Button>
      </div>

      {/* Mobile: filter button */}
      <Dialog open={isFilterModalOpen} onOpenChange={setIsFilterModalOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="h-10 gap-2 sm:hidden">
            <Filter className="h-4 w-4" />
            {t('filters')}
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('filterTitle')}</DialogTitle>
          </DialogHeader>
          {fullModalContent}
          {modalFooter}
        </DialogContent>
      </Dialog>

      {/* Desktop: inline filters */}
      <div className="hidden flex-wrap items-end gap-4 sm:flex">
        <div>
          <Label htmlFor="activity-filter" className="mb-2 block text-sm font-medium">
            Activity
          </Label>
          <Select value={selectedActivity} onValueChange={handleFilterChange(setSelectedActivity)}>
            <SelectTrigger id="activity-filter">
              <SelectValue placeholder="All activities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activities</SelectItem>
              {sortedActivityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="city-filter" className="mb-2 block text-sm font-medium">
            City
          </Label>
          <Select value={selectedCity} onValueChange={handleFilterChange(setSelectedCity)}>
            <SelectTrigger id="city-filter">
              <SelectValue placeholder="All cities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {filterOptions.cities.map((city) => (
                <SelectItem key={city} value={city}>
                  {city}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="country-filter" className="mb-2 block text-sm font-medium">
            Country
          </Label>
          <Select value={selectedCountry} onValueChange={handleFilterChange(setSelectedCountry)}>
            <SelectTrigger id="country-filter">
              <SelectValue placeholder="All countries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {filterOptions.countries.map((country) => (
                <SelectItem key={country} value={country}>
                  {country}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="sort-filter" className="mb-2 block text-sm font-medium">
            {t('sortBy')}
          </Label>
          <Select
            value={sortBy}
            onValueChange={(value) => {
              setSortBy(value as SortBy);
              setHasSearched(true);
            }}
          >
            <SelectTrigger id="sort-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">{t('newestFirst')}</SelectItem>
              <SelectItem value="date_asc">{t('oldestFirst')}</SelectItem>
              <SelectItem value="name_asc">{t('nameAZ')}</SelectItem>
              <SelectItem value="name_desc">{t('nameZA')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Desktop When date range picker */}
        <div>
          <Label className="mb-2 block text-sm font-medium">When</Label>
          <Popover open={whenPopoverOpen} onOpenChange={setWhenPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'h-9 justify-start gap-2 font-normal',
                  !inlineRange?.from && !inlineRange?.to && 'text-muted-foreground',
                )}
              >
                <CalendarIcon className="h-4 w-4" />
                {inlineRange?.from || inlineRange?.to
                  ? dateRangeLabel(
                      inlineRange.from ? format(inlineRange.from, 'yyyy-MM-dd') : '',
                      inlineRange.to ? format(inlineRange.to, 'yyyy-MM-dd') : '',
                    )
                  : 'Pick dates'}
                {(inlineRange?.from || inlineRange?.to) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyInlineRange(undefined);
                    }}
                    className="ml-1 rounded-full hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={inlineRange}
                onSelect={applyInlineRange}
                numberOfMonths={1}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <Label className="mb-2 block text-sm font-medium">Photographer</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by username..."
              value={photographerQuery}
              onChange={(e) => {
                setPhotographerQuery(e.target.value);
                setHasSearched(true);
              }}
              className="h-9 pl-9 pr-9"
            />
            {photographerQuery && (
              <button
                type="button"
                onClick={() => {
                  setPhotographerQuery('');
                  setHasSearched(true);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {hasFilters && (
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="h-9"
            >
              Clear all
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
