'use client';

import { format } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import { motion } from 'framer-motion';
import { Clock, Search, SlidersHorizontal, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import type { PhotographerSearchResult } from '@/app/[lang]/dashboard/talent/events/actions';
import {
  type EventSuggestion,
  searchSuggestionsAction,
} from '@/app/[lang]/dashboard/talent/events/actions';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import type { SortBy } from '@/hooks/use-event-search';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { ActivityDropdown } from './ActivityDropdown';
import { useActivityCombobox } from './EventSearchBar.hooks';
import type { EventSearchBarProps } from './EventSearchBar.types';
import {
  BLUR_DISMISS_DELAY_MS,
  isLikelyAccessCode,
  last3DaysRange,
  lastWeekRange,
  parseDateStr,
  todayRange,
  whenLabel,
} from './EventSearchBar.utils';
import { MOBILE_CALENDAR_COMPONENTS } from './MobileCalendarComponents';
import { WhereSuggestionsDropdown } from './WhereSuggestionsDropdown';

export function EventSearchBar({
  variant = 'hero',
  initialWhere = '',
  initialActivity = '',
  initialDateFrom = '',
  initialDateTo = '',
  initialPreset,
  initialPhotographer = '',
  initialLat: _initialLat,
  initialLng: _initialLng,
  initialRadius: _initialRadius,
  sortBy,
  onSortChange,
  onSearch,
  searchHref = '/events',
  accessCodeHref,
  showMobileFilters = true,
  className,
}: EventSearchBarProps) {
  // Default the access-code redirect to the same base as the search-results
  // redirect. Both happen to share the same prefix on every consumer today
  // (`/events` for public, `/dashboard/talent/events` for talent dashboard),
  // so a single `searchHref` covers both routes without callers having to
  // repeat themselves. Callers that need to diverge can still pass an
  // explicit `accessCodeHref`.
  const resolvedAccessCodeHref = accessCodeHref ?? searchHref;
  const router = useRouter();
  const { t } = useTranslations<Dictionary['eventSearchBar']>();
  const lp = useLocalizedPath();

  const params = useParams<{ lang: string }>();
  const calendarLocale = params?.lang === 'es' ? es : enUS;

  const [where, setWhere] = useState(initialWhere);
  const [photographer, setPhotographer] = useState(initialPhotographer);
  const whereRef = useRef<HTMLInputElement>(null);
  const activityInputRef = useRef<HTMLInputElement>(null);
  const whereContainerRef = useRef<HTMLDivElement>(null);

  const [filterModalOpen, setFilterModalOpen] = useState(false);

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

  const [presetLabel, setPresetLabel] = useState<string | null>(initialPreset ?? null);
  const [mobileDialogOpen, setMobileDialogOpen] = useState(false);
  const [mobileMoreFiltersOpen, setMobileMoreFiltersOpen] = useState(
    () => !!initialActivity || !!initialDateFrom || !!initialDateTo || !!initialPhotographer,
  );
  const [mobileWhenOpen, setMobileWhenOpen] = useState(false);
  const [modalWhenOpen, setModalWhenOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [eventSuggestions, setEventSuggestions] = useState<EventSuggestion[]>([]);
  const [photographerSuggestions, setPhotographerSuggestions] = useState<
    PhotographerSearchResult[]
  >([]);

  const sortedActivities = useMemo(
    () => [...activityOptions].sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );
  const activity = useActivityCombobox(initialActivity, sortedActivities);
  const debouncedWhere = useDebounce(where, 150);

  useEffect(() => {
    if (!debouncedWhere.trim()) {
      setEventSuggestions([]);
      setPhotographerSuggestions([]);
      return;
    }
    searchSuggestionsAction(debouncedWhere)
      .then(({ events, photographers }) => {
        setEventSuggestions(events);
        setPhotographerSuggestions(photographers);
      })
      .catch(() => {
        setEventSuggestions([]);
        setPhotographerSuggestions([]);
      });
  }, [debouncedWhere]);

  // Close activity dropdown when filter modal opens so it doesn't auto-open
  useEffect(() => {
    if (filterModalOpen) activity.setOpen(false);
  }, [filterModalOpen, activity.setOpen]);

  const handleClearAll = useCallback(() => {
    setWhere('');
    setEventSuggestions([]);
    setPhotographerSuggestions([]);
    setShowSuggestions(false);
    activity.clear();
    setDateRange(undefined);
    setPresetLabel(null);
  }, [activity]);

  const handleClearFilters = useCallback(() => {
    activity.clear();
    setDateRange(undefined);
    setPresetLabel(null);
    setPhotographer('');
  }, [activity]);

  const handleClearDateRange = useCallback(() => {
    setDateRange(undefined);
    setPresetLabel(null);
  }, []);

  const handleSelectPreset = useCallback((label: string, range: DateRange) => {
    setPresetLabel(label);
    setDateRange(range);
    setMobileWhenOpen(false);
    setModalWhenOpen(false);
  }, []);

  const handleSearch = useCallback(() => {
    setShowSuggestions(false);
    const validatedActivity = activity.validate();
    if (validatedActivity === null) return;

    // If the where input looks like an access code, route directly to that
    // event. The destination route is controlled by `resolvedAccessCodeHref`
    // — the public viewer renders at `/events/<code>`, while the talent
    // dashboard wraps the same content at `/dashboard/talent/events/<code>`
    // so the dashboard chrome stays visible for authenticated talents.
    const trimmedWhere = where.trim();
    if (trimmedWhere && isLikelyAccessCode(trimmedWhere)) {
      setMobileDialogOpen(false);
      router.push(lp(`${resolvedAccessCodeHref}/${trimmedWhere.toUpperCase()}`));
      return;
    }

    const df = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const dt = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';

    if (onSearch) {
      onSearch(where, validatedActivity, df, dt);
      setMobileDialogOpen(false);
      return;
    }
    const params = new URLSearchParams();
    if (trimmedWhere) params.set('where', trimmedWhere);
    if (validatedActivity) params.set('activity', validatedActivity);
    if (df) params.set('dateFrom', df);
    if (dt) params.set('dateTo', dt);
    if (presetLabel) params.set('preset', presetLabel);
    if (photographer.trim()) params.set('photographer', photographer.trim());
    setMobileDialogOpen(false);
    router.push(`${searchHref}?${params.toString()}`);
  }, [
    activity,
    where,
    dateRange,
    onSearch,
    searchHref,
    resolvedAccessCodeHref,
    router,
    presetLabel,
    photographer,
    lp,
  ]);

  const displayLabel = presetLabel ?? whenLabel(dateRange?.from, dateRange?.to);

  const suggestionTranslations = {
    eventsLabel: t('eventsLabel'),
    photographersLabel: t('photographersLabel'),
  };

  const handleSelectEvent = useCallback(
    (event: EventSuggestion) => {
      setShowSuggestions(false);
      router.push(lp(`/events/${event.slug ?? event.id}`));
    },
    [router, lp],
  );

  const handleSelectPhotographer = useCallback(
    (slug: string) => {
      setShowSuggestions(false);
      router.push(lp(`/photographer/${slug}`));
    },
    [router, lp],
  );

  const handleWhereClear = useCallback(() => {
    setWhere('');
    setEventSuggestions([]);
    whereRef.current?.focus();
  }, []);

  const activeFilterCount =
    (activity.selectedValue ? 1 : 0) + (dateRange?.from ? 1 : 0) + (photographer.trim() ? 1 : 0);

  if (variant === 'hero') {
    return (
      <div className={cn('w-full max-w-3xl', className)}>
        <div className="md:hidden w-full flex justify-center items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileDialogOpen(true)}
            className="flex h-14 items-center rounded-full border bg-background px-8 gap-3 shadow-lg"
          >
            <Search className="h-5 w-5 text-foreground/80" />
            <span className="font-medium tracking-wider text-foreground/80">{t('mobileText')}</span>
          </button>
          {showMobileFilters && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setMobileMoreFiltersOpen(true);
                  setMobileDialogOpen(true);
                }}
                aria-label={t('filters')}
                className={cn(
                  'flex h-14 w-14 items-center justify-center rounded-full border bg-background shadow-lg transition-colors hover:bg-muted',
                  activeFilterCount > 0 && 'border-foreground/40 border-2',
                )}
              >
                <SlidersHorizontal className="h-5 w-5" />
              </button>
              {activeFilterCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground shadow-sm">
                  {activeFilterCount}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Mobile full-screen dialog — all fields always visible */}
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
                  onMouseDown={() => {
                    setMobileWhenOpen(false);
                    activity.setOpen(false);
                  }}
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
                        setShowSuggestions(true);
                      }}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() =>
                        setTimeout(() => setShowSuggestions(false), BLUR_DISMISS_DELAY_MS)
                      }
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
                        onClick={handleWhereClear}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {showSuggestions && (
                    <WhereSuggestionsDropdown
                      events={eventSuggestions}
                      photographers={photographerSuggestions}
                      hasInput={!!where.trim()}
                      onSelectEvent={handleSelectEvent}
                      onSelectPhotographer={handleSelectPhotographer}
                      t={suggestionTranslations}
                    />
                  )}
                </section>

                {!mobileMoreFiltersOpen && (
                  <button
                    type="button"
                    onClick={() => setMobileMoreFiltersOpen(true)}
                    className="flex w-full items-center justify-between rounded-2xl border bg-background px-4 py-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
                  >
                    <span className="flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4" />
                      {t('moreFilters')}
                    </span>
                    {activeFilterCount > 0 && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                )}

                {mobileMoreFiltersOpen && (
                  <>
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
                      <div className="flex items-center">
                        <button
                          type="button"
                          className="flex-1 px-4 py-3 text-left"
                          onMouseDown={() => {
                            activity.setOpen(false);
                            setMobileWhenOpen((o) => !o);
                          }}
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {t('whenLabel')}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <span
                              className={cn(
                                'flex-1 text-base font-medium',
                                displayLabel ? 'text-foreground' : 'text-muted-foreground/50',
                              )}
                            >
                              {displayLabel ?? t('addDates')}
                            </span>
                          </div>
                        </button>
                        {displayLabel && (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleClearDateRange();
                            }}
                            className="px-4 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {mobileWhenOpen && (
                        <div className="border-t">
                          <div className="flex flex-wrap gap-2 px-3 py-3">
                            {[
                              { label: t('presetToday'), getRange: todayRange },
                              { label: t('presetLast3Days'), getRange: last3DaysRange },
                              { label: t('presetLastWeek'), getRange: lastWeekRange },
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
                              month_grid: 'w-full',
                              weekdays: 'flex w-full',
                              week: 'flex w-full mt-2',
                            }}
                            components={MOBILE_CALENDAR_COMPONENTS}
                          />
                        </div>
                      )}
                    </div>

                    <section className="rounded-2xl border bg-background px-4 py-3 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('photographerLabel')}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          id="event-search-photographer-mobile"
                          name="photographer-mobile"
                          type="text"
                          placeholder={t('photographerPlaceholder')}
                          value={photographer}
                          onChange={(e) => setPhotographer(e.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/50"
                        />
                        {photographer && (
                          <button
                            type="button"
                            onClick={() => setPhotographer('')}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </section>

                    {sortBy !== undefined && onSortChange && (
                      <section className="rounded-2xl border bg-background px-4 py-3 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {t('sortBy')}
                        </p>
                        <select
                          id="event-search-sort-mobile"
                          name="sort-mobile"
                          value={sortBy}
                          onChange={(e) => onSortChange(e.target.value as SortBy)}
                          className="mt-2 w-full bg-transparent text-base font-medium text-foreground outline-none"
                        >
                          <option value="date_desc">{t('newestFirst')}</option>
                          <option value="date_asc">{t('oldestFirst')}</option>
                          <option value="name_asc">{t('nameAZ')}</option>
                          <option value="name_desc">{t('nameZA')}</option>
                        </select>
                      </section>
                    )}
                  </>
                )}
              </div>

              <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-4 py-3 md:hidden">
                <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleClearAll}
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
          </DialogContent>
        </Dialog>

        {/* Filter modal — desktop */}
        <Dialog
          open={filterModalOpen}
          onOpenChange={(open) => {
            setFilterModalOpen(open);
            if (!open) setModalWhenOpen(false);
          }}
        >
          <DialogContent
            className="sm:max-w-md flex flex-col p-0 gap-0 max-h-[85vh] overflow-hidden"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <DialogHeader className="px-6 py-4 border-b shrink-0">
              <DialogTitle>{t('filters')}</DialogTitle>
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">
              {/* Activity — inline expandable card */}
              <div
                ref={activity.containerRef}
                className="rounded-xl border bg-background overflow-hidden"
              >
                <div className="px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('activityLabel')}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      id="event-search-activity-modal"
                      name="activity-modal"
                      type="text"
                      placeholder={t('activityPlaceholder')}
                      value={activity.inputValue}
                      onChange={(e) => {
                        activity.setInputValue(e.target.value);
                        activity.setOpen(true);
                      }}
                      onFocus={() => activity.setOpen(true)}
                      onBlur={() =>
                        setTimeout(() => activity.setOpen(false), BLUR_DISMISS_DELAY_MS)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') activity.setOpen(false);
                      }}
                      className={cn(
                        'min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50',
                        activity.error &&
                          'animate-[shake_0.35s_ease-in-out] text-destructive placeholder:text-destructive/40',
                      )}
                    />
                    {activity.inputValue && (
                      <button
                        type="button"
                        onClick={() => activity.clear()}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                {activity.open && activity.filtered.length > 0 && (
                  <div className="border-t max-h-48 overflow-y-auto py-1">
                    {activity.filtered.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          activity.select(opt);
                        }}
                        className="w-full px-4 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* When — inline expandable card with calendar */}
              <div className="rounded-xl border bg-background overflow-hidden">
                <div className="flex items-center">
                  <button
                    type="button"
                    className="flex-1 px-4 py-3 text-left"
                    onClick={() => setModalWhenOpen((o) => !o)}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t('whenLabel')}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={cn(
                          'flex-1 text-sm font-medium',
                          displayLabel ? 'text-foreground' : 'text-muted-foreground/50',
                        )}
                      >
                        {displayLabel ?? t('addDates')}
                      </span>
                    </div>
                  </button>
                  {displayLabel && (
                    <button
                      type="button"
                      onClick={handleClearDateRange}
                      className="px-4 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {modalWhenOpen && (
                  <div className="border-t">
                    <div className="flex flex-wrap gap-2 px-3 py-2">
                      {[
                        { label: t('presetToday'), getRange: todayRange },
                        { label: t('presetLast3Days'), getRange: last3DaysRange },
                        { label: t('presetLastWeek'), getRange: lastWeekRange },
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
                    <div className="flex justify-center">
                      <Calendar
                        mode="range"
                        selected={dateRange}
                        onSelect={(range) => {
                          setDateRange(range);
                          setPresetLabel(null);
                          if (range?.from && range?.to) setModalWhenOpen(false);
                        }}
                        locale={calendarLocale}
                        numberOfMonths={1}
                        className="p-2 [--cell-size:--spacing(7)] [&_button]:text-[12px]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Photographer */}
              <div className="rounded-xl border bg-background px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('photographerLabel')}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="event-search-photographer-modal"
                    name="photographer-modal"
                    type="text"
                    placeholder={t('photographerPlaceholder')}
                    value={photographer}
                    onChange={(e) => setPhotographer(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                  {photographer && (
                    <button
                      type="button"
                      onClick={() => setPhotographer('')}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {sortBy !== undefined && onSortChange && (
                <div className="rounded-xl border bg-background px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('sortBy')}
                  </p>
                  <select
                    id="event-search-sort-modal"
                    name="sort-modal"
                    value={sortBy}
                    onChange={(e) => onSortChange(e.target.value as SortBy)}
                    className="mt-2 w-full bg-transparent text-sm font-medium text-foreground outline-none"
                  >
                    <option value="date_desc">{t('newestFirst')}</option>
                    <option value="date_asc">{t('oldestFirst')}</option>
                    <option value="name_asc">{t('nameAZ')}</option>
                    <option value="name_desc">{t('nameZA')}</option>
                  </select>
                </div>
              )}
            </div>

            <DialogFooter className="px-6 py-4 border-t shrink-0 flex-row items-center justify-between sm:justify-between">
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline hover:text-foreground transition-colors"
              >
                {t('clearFilters')}
              </button>
              <Button
                onClick={() => {
                  setFilterModalOpen(false);
                  handleSearch();
                }}
                className="rounded-full px-6"
              >
                {t('apply')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Desktop bar — always visible */}
        <div className="hidden md:flex justify-center">
          <div className="w-full max-w-xl rounded-full border-2 bg-background shadow-md">
            <div className="flex items-stretch">
              {/* Where */}
              <div
                ref={whereContainerRef}
                className="relative flex flex-1 min-w-0 items-center gap-2 pl-5 pr-3 min-h-14"
              >
                <Search className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <input
                  ref={whereRef}
                  id="event-search-where"
                  name="where"
                  type="text"
                  autoComplete="off"
                  placeholder={t('searchByNameLocationPhotographer')}
                  value={where}
                  onChange={(e) => {
                    setWhere(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), BLUR_DISMISS_DELAY_MS)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setShowSuggestions(false);
                      handleSearch();
                    }
                    if (e.key === 'Escape') setShowSuggestions(false);
                  }}
                  className="min-w-0 flex-1 w-0 h-auto outline-none p-0 text-sm text-foreground font-medium focus-visible:ring-0 shadow-none bg-transparent placeholder:text-muted-foreground/60 [&:-webkit-autofill]:[box-shadow:0_0_0_1000px_white_inset]!"
                />
                {where && (
                  <button
                    type="button"
                    onClick={handleWhereClear}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}

                {showSuggestions && (
                  <WhereSuggestionsDropdown
                    events={eventSuggestions}
                    photographers={photographerSuggestions}
                    hasInput={!!where.trim()}
                    onSelectEvent={handleSelectEvent}
                    onSelectPhotographer={handleSelectPhotographer}
                    t={suggestionTranslations}
                  />
                )}
              </div>

              {/* Filters button — icon + label pill, with corner badge when filters active */}
              <div className="relative flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => setFilterModalOpen(true)}
                  className={cn(
                    'flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors hover:bg-muted',
                    activeFilterCount > 0 && 'border-foreground/70 border-2',
                  )}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>{t('filters')}</span>
                </button>
                {activeFilterCount > 0 && (
                  <span className="absolute -right-0.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground shadow-sm">
                    {activeFilterCount}
                  </span>
                )}
              </div>

              {/* Search button */}
              <div className="flex shrink-0 items-center p-2">
                <button
                  type="button"
                  onClick={handleSearch}
                  aria-label="Search events"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80"
                >
                  <Search className="h-5 w-5" />
                </button>
              </div>
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
