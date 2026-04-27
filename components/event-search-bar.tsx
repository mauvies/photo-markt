'use client';

import { format, parseISO } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarIcon, ChevronLeft, Clock, MapPin, Navigation, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { createPortal } from 'react-dom';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { searchEventNamesAction } from '@/app/[lang]/dashboard/talent/events/actions';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounce } from '@/hooks/use-debounce';
import { type PlacePrediction, usePlacesAutocomplete } from '@/hooks/use-places-autocomplete';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';

interface EventSearchBarProps {
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

interface ActivityOption {
  value: string;
  label: string;
}

const DROPDOWN_MAX_H = 240;
const DROPDOWN_GAP = 8;

// ─── Date preset helpers ──────────────────────────────────────────────────────

function todayRange(): DateRange {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return { from: d, to: d };
}

function last3DaysRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 2);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

function lastWeekRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

// ─── Activity dropdown ────────────────────────────────────────────────────────

function ActivityDropdown({
  filtered,
  anchorRef,
  onSelect,
  compact,
}: {
  filtered: ActivityOption[];
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (opt: ActivityOption) => void;
  compact?: boolean;
}) {
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  const [openUpward, setOpenUpward] = useState(false);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const goUp = spaceBelow < DROPDOWN_MAX_H + DROPDOWN_GAP && rect.top > spaceBelow;

    setOpenUpward(goUp);
    setStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, compact ? 200 : 220),
      zIndex: 9999,
      ...(goUp
        ? { bottom: window.innerHeight - rect.top + DROPDOWN_GAP }
        : { top: rect.bottom + DROPDOWN_GAP }),
    });
  }, [anchorRef, compact]);

  return createPortal(
    <div
      style={style}
      className={cn(
        'bg-background border shadow-xl overflow-y-auto py-1',
        'max-h-60',
        openUpward
          ? 'rounded-t-2xl rounded-b-lg animate-[dropdown-up_0.15s_ease-out]'
          : 'rounded-2xl animate-[dropdown-down_0.15s_ease-out]',
      )}
    >
      {filtered.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(opt);
          }}
          className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors"
        >
          {opt.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ─── Activity combobox hook ───────────────────────────────────────────────────

function useActivityCombobox(initialActivity: string, sortedActivities: ActivityOption[]) {
  const initialLabel = sortedActivities.find((a) => a.value === initialActivity)?.label ?? '';
  const [inputValue, setInputValue] = useState(initialLabel);
  const [selectedValue, setSelectedValue] = useState(initialActivity || '');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!inputValue.trim()) return sortedActivities;
    return sortedActivities.filter((a) => a.label.toLowerCase().includes(inputValue.toLowerCase()));
  }, [inputValue, sortedActivities]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = useCallback((opt: ActivityOption) => {
    setInputValue(opt.label);
    setSelectedValue(opt.value);
    setError(false);
    setOpen(false);
  }, []);

  const clear = useCallback(() => {
    setInputValue('');
    setSelectedValue('');
    setError(false);
  }, []);

  const validate = useCallback((): string | null => {
    if (!inputValue.trim()) return '';
    const match = sortedActivities.find((a) => a.label.toLowerCase() === inputValue.toLowerCase());
    if (!match) {
      setError(true);
      setTimeout(() => setError(false), 600);
      return null;
    }
    return match.value;
  }, [inputValue, sortedActivities]);

  return {
    inputValue,
    setInputValue,
    selectedValue,
    open,
    setOpen,
    error,
    filtered,
    containerRef,
    select,
    clear,
    validate,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDateStr(s: string): Date | undefined {
  if (!s) return undefined;
  try {
    return parseISO(s);
  } catch {
    return undefined;
  }
}

function whenLabel(from: Date | undefined, to: Date | undefined): string | null {
  if (from && to) {
    const sameDay = format(from, 'yyyy-MM-dd') === format(to, 'yyyy-MM-dd');
    return sameDay ? format(from, 'MMM d') : `${format(from, 'MMM d')} – ${format(to, 'MMM d')}`;
  }
  if (from) return format(from, 'MMM d');
  if (to) return `Until ${format(to, 'MMM d')}`;
  return null;
}

// ─── When popover content ─────────────────────────────────────────────────────

function WhenPopoverContent({
  dateRange,
  onSelectPreset,
  onSelectCustom,
  mobile = false,
  t,
}: {
  dateRange: DateRange | undefined;
  onSelectPreset: (label: string, range: DateRange) => void;
  onSelectCustom: (range: DateRange | undefined) => void;
  mobile?: boolean;
  t: {
    quickOptions: string;
    customDate: string;
    presetToday: string;
    presetLast3Days: string;
    presetLastWeek: string;
  };
}) {
  const [showCalendar, setShowCalendar] = useState(false);

  if (showCalendar) {
    return (
      <div className={mobile ? 'w-full' : undefined}>
        <button
          type="button"
          onClick={() => setShowCalendar(false)}
          className="flex items-center gap-1 px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t.quickOptions}
        </button>
        <Calendar
          mode="range"
          selected={dateRange}
          onSelect={(range) => {
            onSelectCustom(range);
          }}
          numberOfMonths={1}
          {...(mobile && {
            className: '!p-0',
            classNames: { root: 'w-full max-w-full' },
          })}
        />
      </div>
    );
  }

  const presets = [
    { label: t.presetToday, getRange: todayRange },
    { label: t.presetLast3Days, getRange: last3DaysRange },
    { label: t.presetLastWeek, getRange: lastWeekRange },
  ];

  return (
    <div className="w-48 p-3">
      {presets.map(({ label, getRange }) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelectPreset(label, getRange())}
          className="flex w-full items-center gap-2.5 rounded-lg py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors text-left"
        >
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {label}
        </button>
      ))}
      <div className="my-1.5 h-px bg-border" />
      <button
        type="button"
        onClick={() => setShowCalendar(true)}
        className="flex w-full items-center gap-2.5 rounded-lg py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors text-left"
      >
        <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {t.customDate}
      </button>
    </div>
  );
}

// ─── Where suggestions dropdown ───────────────────────────────────────────────

function WhereSuggestionsDropdown({
  placePredictions,
  eventNames,
  hasInput,
  onSelectPlace,
  onSelectEventName,
  onUseCurrentLocation,
  t,
}: {
  placePredictions: PlacePrediction[];
  eventNames: string[];
  hasInput: boolean;
  onSelectPlace: (p: PlacePrediction) => void;
  onSelectEventName: (name: string) => void;
  onUseCurrentLocation: () => void;
  t: { useCurrentLocation: string; locationsLabel: string; eventsLabel: string };
}) {
  const showPlaces = hasInput && placePredictions.length > 0;
  const showEvents = hasInput && eventNames.length > 0;
  const showCurrentLocation =
    !hasInput && typeof navigator !== 'undefined' && !!navigator.geolocation;

  if (!showPlaces && !showEvents && !showCurrentLocation) return null;

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-2xl border bg-popover shadow-xl">
      {/* Current location — shown when input is empty */}
      {showCurrentLocation && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onUseCurrentLocation();
          }}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors text-left"
        >
          <Navigation className="h-4 w-4 shrink-0 text-primary" />
          {t.useCurrentLocation}
        </button>
      )}

      {/* Google Places suggestions */}
      {showPlaces && (
        <>
          <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t.locationsLabel}
          </p>
          {placePredictions.map((p) => (
            <button
              key={p.placeId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectPlace(p);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium">{p.mainText}</span>
                {p.secondaryText && (
                  <span className="text-muted-foreground">, {p.secondaryText}</span>
                )}
              </span>
            </button>
          ))}
        </>
      )}

      {/* Divider */}
      {showPlaces && showEvents && <div className="mx-4 my-1 h-px bg-border" />}

      {/* Event name suggestions */}
      {showEvents && (
        <>
          <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t.eventsLabel}
          </p>
          {eventNames.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectEventName(name);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {name}
            </button>
          ))}
        </>
      )}

      {/* Bottom padding */}
      {/* <div className="h-1.5" /> */}
    </div>
  );
}

// ─── Mobile calendar semantic table components ────────────────────────────────

function MobileMonthGrid({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={className} {...props} />;
}
function MobileWeeks({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}
function MobileWeekdays({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={className} {...props} />;
}
function MobileWeekday({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={className} {...props} />;
}
function MobileWeek({
  week: _week,
  className,
  ...props
}: { week: unknown } & React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={className} {...(props as React.HTMLAttributes<HTMLTableRowElement>)} />;
}
function MobileDay({
  day: _day,
  modifiers: _modifiers,
  className,
  ...props
}: { day: unknown; modifiers: unknown } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={className} {...props} />;
}

const MOBILE_CALENDAR_COMPONENTS = {
  MonthGrid: MobileMonthGrid,
  Weeks: MobileWeeks,
  Weekdays: MobileWeekdays,
  Weekday: MobileWeekday,
  Week: MobileWeek,
  Day: MobileDay,
};

// ─── Main component ───────────────────────────────────────────────────────────

export function EventSearchBar({
  variant = 'hero',
  initialWhere = '',
  initialActivity = '',
  initialDateFrom = '',
  initialDateTo = '',
  initialPreset,
  initialLat,
  initialLng,
  initialRadius,
  onSearch,
  searchHref = '/events',
  className,
}: EventSearchBarProps) {
  const router = useRouter();
  const { t } = useTranslations<Dictionary['eventSearchBar']>();
  const [where, setWhere] = useState(initialWhere);
  const whereRef = useRef<HTMLInputElement>(null);
  const activityInputRef = useRef<HTMLInputElement>(null);

  // If a known preset is passed, recompute its range so "Today" is always fresh
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (initialPreset === 'Today') return todayRange();
    if (initialPreset === 'Last 3 days') return last3DaysRange();
    if (initialPreset === 'Last week') return lastWeekRange();
    const from = parseDateStr(initialDateFrom);
    const to = parseDateStr(initialDateTo);
    if (from || to) return { from, to };
    return undefined;
  });

  // Track the preset label (null = any dates / custom)
  const [presetLabel, setPresetLabel] = useState<string | null>(initialPreset ?? null);

  const [searchLat, setSearchLat] = useState<number | undefined>(initialLat);
  const [searchLng, setSearchLng] = useState<number | undefined>(initialLng);
  const [radius, setRadius] = useState<number>(initialRadius ?? (initialLat ? 25 : 0));
  const [mobileDialogOpen, setMobileDialogOpen] = useState(false);
  const [mobileWhenOpen, setMobileWhenOpen] = useState(false);

  const [whenOpen, setWhenOpen] = useState(false);

  const sortedActivities = useMemo(
    () => [...activityOptions].sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  const activity = useActivityCombobox(initialActivity, sortedActivities);

  // Places autocomplete + event name suggestions
  const { getPredictions, getDetails } = usePlacesAutocomplete();
  const debouncedWhere = useDebounce(where, 250);
  const [placePredictions, setPlacePredictions] = useState<PlacePrediction[]>([]);
  const [eventNameSuggestions, setEventNameSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const whereContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!debouncedWhere.trim()) {
      setPlacePredictions([]);
      setEventNameSuggestions([]);
      return;
    }
    getPredictions(debouncedWhere)
      .then(setPlacePredictions)
      .catch(() => setPlacePredictions([]));
    searchEventNamesAction(debouncedWhere)
      .then(setEventNameSuggestions)
      .catch(() => setEventNameSuggestions([]));
  }, [debouncedWhere, getPredictions]);

  const handleSelectPlace = useCallback(
    async (prediction: PlacePrediction) => {
      setShowSuggestions(false);
      setWhere(prediction.mainText);
      const details = await getDetails(prediction.placeId);
      if (details) {
        setSearchLat(details.lat);
        setSearchLng(details.lng);
        setRadius(25);
      }
    },
    [getDetails],
  );

  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setShowSuggestions(false);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setSearchLat(latitude);
        setSearchLng(longitude);
        setRadius(25);

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
            { headers: { 'Accept-Language': 'en' } },
          );
          const data = await res.json();
          const city: string =
            data.address?.city ?? data.address?.town ?? data.address?.village ?? 'Nearby';
          setWhere(city);
        } catch {
          setWhere('Nearby');
        }
      },
      () => {}, // permission denied — silently ignore
    );
  }, []);

  const clearAll = useCallback(() => {
    setWhere('');
    setPlacePredictions([]);
    setEventNameSuggestions([]);
    setShowSuggestions(false);
    setSearchLat(undefined);
    setSearchLng(undefined);
    setRadius(0);
    activity.clear();
    setDateRange(undefined);
    setPresetLabel(null);
  }, [activity]);

  const handleSearch = useCallback(() => {
    setShowSuggestions(false);
    const validatedActivity = activity.validate();
    if (validatedActivity === null) return;

    const df = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const dt = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';

    if (onSearch) {
      onSearch(where, validatedActivity, df, dt);
      setMobileDialogOpen(false);
      return;
    }
    const params = new URLSearchParams();
    if (where.trim()) params.set('where', where.trim());
    if (validatedActivity) params.set('activity', validatedActivity);
    if (df) params.set('dateFrom', df);
    if (dt) params.set('dateTo', dt);
    if (presetLabel) params.set('preset', presetLabel);
    if (searchLat !== undefined && searchLng !== undefined) {
      params.set('lat', searchLat.toFixed(6));
      params.set('lng', searchLng.toFixed(6));
      params.set('radius', radius.toString());
    }
    setMobileDialogOpen(false);
    router.push(`${searchHref}?${params.toString()}`);
  }, [
    activity,
    where,
    dateRange,
    onSearch,
    searchHref,
    router,
    presetLabel,
    searchLat,
    searchLng,
    radius,
  ]);

  const displayLabel = presetLabel ?? whenLabel(dateRange?.from, dateRange?.to);

  const clearDateRange = useCallback(() => {
    setDateRange(undefined);
    setPresetLabel(null);
  }, []);

  const handleSelectPreset = useCallback((label: string, range: DateRange) => {
    setPresetLabel(label);
    setDateRange(range);
    setWhenOpen(false);
    setMobileWhenOpen(false);
  }, []);

  const handleSelectCustom = useCallback((range: DateRange | undefined) => {
    setDateRange(range);
    setPresetLabel(null);

    if (range?.from && range?.to) {
      setWhenOpen(false);
      setMobileWhenOpen(false);
    }
  }, []);

  if (variant === 'hero') {
    return (
      <div className={cn('w-full max-w-3xl', className)}>
        <div className="md:hidden w-full flex justify-center">
          <button
            type="button"
            onClick={() => setMobileDialogOpen(true)}
            className="flex h-14 items-center rounded-full border bg-background px-10 gap-3 shadow-lg"
          >
            <Search className="h-5 w-5 text-foreground/80" />
            <span className="font-medium tracking-wider text-foreground/80">{t('mobileText')}</span>
          </button>
        </div>

        <Dialog
          open={mobileDialogOpen}
          onOpenChange={(open) => {
            setMobileDialogOpen(open);
            if (!open) setMobileWhenOpen(false);
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="inset-0 h-dvh max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0"
          >
            <DialogTitle className="sr-only">Search events</DialogTitle>
            <AnimatePresence mode="wait">
              {mobileDialogOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="flex h-full flex-col bg-background"
                >
                  <div className="flex items-center justify-end px-4 py-6">
                    <DialogClose asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="Close search"
                      >
                        <X className="h-7 w-7" />
                      </button>
                    </DialogClose>
                  </div>

                  <div className="flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-4 pb-28 [scrollbar-gutter:stable]">
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: onMouseDown dismisses the date picker when tapping another field — no semantic role applies */}
                    <section
                      ref={whereContainerRef}
                      className="relative rounded-2xl border bg-background px-4 py-3 shadow-sm"
                      onMouseDown={() => setMobileWhenOpen(false)}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('whereLabel')}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          ref={whereRef}
                          id="event-search-where-mobile"
                          name="where-mobile"
                          type="text"
                          autoComplete="off"
                          placeholder={t('wherePlaceholder')}
                          value={where}
                          onChange={(e) => {
                            setWhere(e.target.value);
                            setSearchLat(undefined);
                            setSearchLng(undefined);
                            setRadius(0);
                            setShowSuggestions(true);
                          }}
                          onFocus={() => setShowSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setShowSuggestions(false);
                              handleSearch();
                            }
                            if (e.key === 'Escape') setShowSuggestions(false);
                          }}
                          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/50"
                        />
                        {where && (
                          <button
                            type="button"
                            onClick={() => {
                              setWhere('');
                              setSearchLat(undefined);
                              setSearchLng(undefined);
                              setRadius(0);
                              setPlacePredictions([]);
                              setEventNameSuggestions([]);
                              whereRef.current?.focus();
                            }}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {showSuggestions && (
                        <WhereSuggestionsDropdown
                          placePredictions={placePredictions}
                          eventNames={eventNameSuggestions}
                          hasInput={!!where.trim()}
                          onSelectPlace={handleSelectPlace}
                          onSelectEventName={(name) => {
                            setWhere(name);
                            setPlacePredictions([]);
                            setEventNameSuggestions([]);
                            setShowSuggestions(false);
                          }}
                          onUseCurrentLocation={handleUseCurrentLocation}
                          t={{
                            useCurrentLocation: t('useCurrentLocation'),
                            locationsLabel: t('locationsLabel'),
                            eventsLabel: t('eventsLabel'),
                          }}
                        />
                      )}
                    </section>

                    {/* biome-ignore lint/a11y/noStaticElementInteractions: onMouseDown dismisses the date picker when tapping another field — no semantic role applies */}
                    <section
                      ref={activity.containerRef}
                      className="relative rounded-2xl border bg-background px-4 py-3 shadow-sm"
                      onMouseDown={() => setMobileWhenOpen(false)}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('activityLabel')}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          ref={activityInputRef}
                          id="event-search-activity-mobile"
                          name="activity-mobile"
                          type="text"
                          placeholder={t('activityPlaceholder')}
                          value={activity.inputValue}
                          onChange={(e) => {
                            activity.setInputValue(e.target.value);
                            activity.setOpen(true);
                          }}
                          onFocus={() => activity.setOpen(true)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSearch();
                            if (e.key === 'Escape') activity.setOpen(false);
                          }}
                          className={cn(
                            'min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/50',
                            activity.error &&
                              'animate-[shake_0.35s_ease-in-out] text-destructive placeholder:text-destructive/40',
                          )}
                        />
                        {activity.inputValue && (
                          <button
                            type="button"
                            onClick={() => {
                              activity.clear();
                              activityInputRef.current?.focus();
                            }}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {activity.open && activity.filtered.length > 0 && (
                        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-background py-1">
                          {activity.filtered.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                activity.select(opt);
                              }}
                              className="w-full py-2.5 text-left text-sm transition-colors hover:bg-muted"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </section>

                    <div className="rounded-2xl border bg-background shadow-sm overflow-hidden">
                      <button
                        type="button"
                        className="w-full px-4 py-3 text-left"
                        onMouseDown={() => {
                          setMobileWhenOpen((o) => !o);
                        }}
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {t('whenLabel')}
                        </p>
                        <div className="mt-2 flex w-full items-center gap-2">
                          <span
                            className={cn(
                              'flex-1 text-base font-medium',
                              displayLabel ? 'text-foreground' : 'text-muted-foreground/50',
                            )}
                          >
                            {displayLabel ?? t('addDates')}
                          </span>
                          {displayLabel && (
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                clearDateRange();
                              }}
                              className="shrink-0 text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </button>
                      {mobileWhenOpen && (
                        <div className="border-t">
                          <div className="flex flex-wrap gap-2 px-3 py-3">
                            {[
                              { label: t('presetToday'), getRange: todayRange },
                              {
                                label: t('presetLast3Days'),
                                getRange: last3DaysRange,
                              },
                              {
                                label: t('presetLastWeek'),
                                getRange: lastWeekRange,
                              },
                            ].map(({ label, getRange }) => (
                              <button
                                key={label}
                                type="button"
                                onClick={() => handleSelectPreset(label, getRange())}
                                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
                              >
                                <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                                {label}
                              </button>
                            ))}
                          </div>
                          <Calendar
                            mode="range"
                            selected={dateRange}
                            onSelect={(range) => {
                              setDateRange(range);
                              setPresetLabel(null);
                              if (range?.from && range?.to) setMobileWhenOpen(false);
                            }}
                            numberOfMonths={1}
                            className="w-full p-2! [--cell-size:--spacing(7)]"
                            classNames={{
                              root: 'w-full',
                              months: 'flex flex-col gap-4 relative w-full',
                              month: 'flex flex-col w-full gap-4',
                              table: 'w-full',
                              weekdays: 'flex w-full',
                              week: 'flex w-full mt-2',
                            }}
                            components={MOBILE_CALENDAR_COMPONENTS}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-4 py-3 md:hidden">
                    <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={clearAll}
                        className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {t('clearAll')}
                      </button>
                      <Button
                        onClick={handleSearch}
                        variant="default"
                        className="h-11 rounded-full px-5 text-sm font-semibold"
                      >
                        <Search className="mr-2 h-4 w-4" />
                        {t('searchButton')}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </DialogContent>
        </Dialog>

        <div className="hidden md:block rounded-2xl pl-3 sm:rounded-full border-2 bg-background shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-stretch">
            {/* Where */}
            <div
              ref={whereContainerRef}
              className="relative flex-1 min-w-0 px-5 pt-4 pb-2 sm:py-0 sm:min-h-[60px] sm:flex sm:flex-col sm:justify-center sm:items-start"
            >
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t('nameOrLocation')}
              </p>
              <div className="flex w-full items-center gap-1">
                <input
                  ref={whereRef}
                  id="event-search-where"
                  name="where"
                  type="text"
                  autoComplete="off"
                  placeholder={t('nameOrLocationPlaceholder')}
                  value={where}
                  onChange={(e) => {
                    setWhere(e.target.value);
                    setSearchLat(undefined);
                    setSearchLng(undefined);
                    setRadius(0);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setShowSuggestions(false);
                      handleSearch();
                    }
                    if (e.key === 'Escape') setShowSuggestions(false);
                  }}
                  className="min-w-0 flex-1 w-0 h-auto outline-none p-0 mt-0.5 text-sm text-muted-foreground font-medium focus-visible:ring-0 shadow-none bg-transparent placeholder:text-muted-foreground/40 [&:-webkit-autofill]:[box-shadow:0_0_0_1000px_white_inset]!"
                />
                <button
                  type="button"
                  onClick={() => {
                    setWhere('');
                    setSearchLat(undefined);
                    setSearchLng(undefined);
                    setRadius(0);
                    setPlacePredictions([]);
                    setEventNameSuggestions([]);
                    whereRef.current?.focus();
                  }}
                  className={cn(
                    'mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-opacity',
                    where ? 'opacity-100' : 'opacity-0 pointer-events-none',
                  )}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Combined dropdown */}
              {showSuggestions && (
                <WhereSuggestionsDropdown
                  placePredictions={placePredictions}
                  eventNames={eventNameSuggestions}
                  hasInput={!!where.trim()}
                  onSelectPlace={handleSelectPlace}
                  onSelectEventName={(name) => {
                    setWhere(name);
                    setPlacePredictions([]);
                    setEventNameSuggestions([]);
                    setShowSuggestions(false);
                  }}
                  onUseCurrentLocation={handleUseCurrentLocation}
                  t={{
                    useCurrentLocation: t('useCurrentLocation'),
                    locationsLabel: t('locationsLabel'),
                    eventsLabel: t('eventsLabel'),
                  }}
                />
              )}
            </div>

            <div className="hidden sm:block w-px bg-border self-stretch my-4" />
            <div className="sm:hidden h-px bg-border mx-5 mt-2" />

            {/* Activity */}
            <div
              ref={activity.containerRef}
              className="relative w-[27%] min-w-0 px-5 pt-3 pb-2 sm:py-0 sm:min-h-[60px] sm:flex sm:flex-col sm:justify-center sm:items-start"
            >
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t('activityLabel')}
              </p>
              <div className="flex w-full items-center gap-1">
                <input
                  ref={activityInputRef}
                  id="event-search-activity"
                  name="activity"
                  type="text"
                  placeholder={t('activityPlaceholder')}
                  value={activity.inputValue}
                  onChange={(e) => {
                    activity.setInputValue(e.target.value);
                    activity.setOpen(true);
                  }}
                  onFocus={() => activity.setOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch();
                    if (e.key === 'Escape') activity.setOpen(false);
                  }}
                  className={cn(
                    'mt-0.5 text-sm text-muted-foreground bg-transparent outline-none min-w-0 flex-1 w-0 placeholder:text-muted-foreground/40 transition-all',
                    activity.error &&
                      'animate-[shake_0.35s_ease-in-out] text-destructive placeholder:text-destructive/40',
                  )}
                />
                {activity.inputValue && (
                  <button
                    type="button"
                    onClick={() => {
                      activity.clear();
                      activityInputRef.current?.focus();
                    }}
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {activity.open &&
                activity.filtered.length > 0 &&
                typeof document !== 'undefined' &&
                !mobileDialogOpen && (
                  <ActivityDropdown
                    filtered={activity.filtered}
                    anchorRef={activity.containerRef}
                    onSelect={activity.select}
                  />
                )}
            </div>

            <div className="hidden sm:block w-px bg-border self-stretch my-4" />
            <div className="sm:hidden h-px bg-border mx-5 mt-2" />

            {/* When */}
            <div className="relative w-[27%] min-w-0 px-5 pt-3 pb-2 sm:py-0 sm:min-h-[60px] sm:flex sm:flex-col sm:justify-center sm:items-start">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t('whenLabel')}
              </p>
              <Popover open={whenOpen} onOpenChange={(o) => setWhenOpen(o)}>
                <div className="mt-0.5 flex w-full items-center gap-1">
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex-1 truncate text-left outline-none min-w-0"
                    >
                      <span
                        className={cn(
                          'block truncate text-sm font-medium',
                          displayLabel ? 'text-muted-foreground' : 'text-muted-foreground/40',
                        )}
                      >
                        {displayLabel ?? t('addDates')}
                      </span>
                    </button>
                  </PopoverTrigger>
                  {displayLabel && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        clearDateRange();
                      }}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <PopoverContent className="w-auto p-0" align="start" sideOffset={12}>
                  <WhenPopoverContent
                    dateRange={dateRange}
                    onSelectPreset={handleSelectPreset}
                    onSelectCustom={handleSelectCustom}
                    t={{
                      quickOptions: t('quickOptions'),
                      customDate: t('customDate'),
                      presetToday: t('presetToday'),
                      presetLast3Days: t('presetLast3Days'),
                      presetLastWeek: t('presetLastWeek'),
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Search button */}
            <div className="p-3 sm:p-2.5 sm:flex sm:items-center sm:justify-center">
              <button
                type="button"
                onClick={handleSearch}
                aria-label="Search events"
                className="flex w-full sm:w-10 h-10 shrink-0 items-center justify-center gap-2 rounded-xl sm:rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80"
              >
                <Search className="h-5 w-5" />
                <span className="sm:hidden text-sm font-semibold">{t('searchButton')}</span>
              </button>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20%       { transform: translateX(-5px); }
            40%       { transform: translateX(5px); }
            60%       { transform: translateX(-3px); }
            80%       { transform: translateX(3px); }
          }
          @keyframes dropdown-down {
            from { opacity: 0; transform: translateY(-6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes dropdown-up {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  // Compact variant
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1.5 hover:bg-muted/60 transition-colors',
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <Input
          ref={whereRef}
          id="event-search-where-compact"
          name="where"
          placeholder={t('whereCompactPlaceholder')}
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="h-6 w-24 border-0 p-0 text-sm focus-visible:ring-0 shadow-none bg-transparent placeholder:text-muted-foreground/50"
        />
        {where && (
          <button
            type="button"
            onClick={() => {
              setWhere('');
              whereRef.current?.focus();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="w-px h-4 bg-border shrink-0" />
      <div ref={activity.containerRef} className="relative flex items-center gap-1">
        <input
          ref={activityInputRef}
          id="event-search-activity-compact"
          name="activity"
          placeholder={t('activityCompactPlaceholder')}
          value={activity.inputValue}
          onChange={(e) => {
            activity.setInputValue(e.target.value);
            activity.setOpen(true);
          }}
          onFocus={() => activity.setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
            if (e.key === 'Escape') activity.setOpen(false);
          }}
          className={cn(
            'h-6 w-24 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50',
            activity.error && 'text-destructive',
          )}
        />
        {activity.inputValue && (
          <button
            type="button"
            onClick={() => {
              activity.clear();
              activityInputRef.current?.focus();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {activity.open && activity.filtered.length > 0 && typeof document !== 'undefined' && (
          <ActivityDropdown
            filtered={activity.filtered}
            anchorRef={activity.containerRef}
            onSelect={activity.select}
            compact
          />
        )}
      </div>
      <Button
        onClick={handleSearch}
        variant="default"
        size="sm"
        className="h-7 w-7 p-0 rounded-full shrink-0"
        aria-label="Search events"
      >
        <Search className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
