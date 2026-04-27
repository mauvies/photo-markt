'use client';

import type { EventWithStats, FilterOptions } from '@/hooks/use-event-search';
import { useEventSearch } from '@/hooks/use-event-search';
import { AIMatchingButton } from '../photos/ai-matching/ai-matching-button';
import { EventFilterBar } from './components/event-filter-bar';
import { EventGrid } from './components/event-grid';
import { EventInfoCards } from './components/event-info-cards';

export function ExplorePageContent({
  initialFilterOptions,
  initialEvents,
  initialTotal,
  initialLat,
  initialLng,
  initialRadius,
  eventLinkPrefix,
  showInfoCards = false,
  loadOnMount = false,
  initialWhere,
  initialActivity,
  initialDateFrom,
  initialDateTo,
  hideTopFilters = false,
  showFindMe = false,
}: {
  initialFilterOptions: FilterOptions;
  initialEvents?: EventWithStats[];
  initialTotal?: number;
  initialLat?: number;
  initialLng?: number;
  initialRadius?: number;
  eventLinkPrefix?: string;
  showInfoCards?: boolean;
  loadOnMount?: boolean;
  initialWhere?: string;
  initialActivity?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
  hideTopFilters?: boolean;
  showFindMe?: boolean;
}) {
  const search = useEventSearch({
    initialFilterOptions,
    initialEvents,
    initialTotal,
    initialLat,
    initialLng,
    initialRadius,
    initialWhere,
    initialActivity,
    initialDateFrom,
    initialDateTo,
    loadOnMount,
  });

  return (
    <div className="space-y-6">
      <EventFilterBar
        hideTopFilters={hideTopFilters}
        searchText={search.searchText}
        setSearchText={search.setSearchText}
        triggerSearch={search.triggerSearch}
        selectedActivity={search.selectedActivity}
        setSelectedActivity={search.setSelectedActivity}
        selectedCity={search.selectedCity}
        setSelectedCity={search.setSelectedCity}
        selectedCountry={search.selectedCountry}
        setSelectedCountry={search.setSelectedCountry}
        sortBy={search.sortBy}
        setSortBy={search.setSortBy}
        dateFrom={search.dateFrom}
        setDateFrom={search.setDateFrom}
        dateTo={search.dateTo}
        setDateTo={search.setDateTo}
        filterOptions={search.filterOptions}
        sortedActivityOptions={search.sortedActivityOptions}
        locationLabel={search.locationLabel}
        hasFilters={search.hasFilters}
        activeFilterCount={search.activeFilterCount}
        dateFilterCount={search.dateFilterCount}
        isFilterModalOpen={search.isFilterModalOpen}
        setIsFilterModalOpen={search.setIsFilterModalOpen}
        handleFilterChange={search.handleFilterChange}
        clearFilters={search.clearFilters}
        setHasSearched={search.setHasSearched}
        extraButtons={showFindMe ? <AIMatchingButton className="h-9 rounded-full" /> : undefined}
        photographerQuery={search.photographerQuery}
        setPhotographerQuery={search.setPhotographerQuery}
        radiusKm={search.radiusKm}
        setRadiusKm={search.setRadiusKm}
      />

      <EventGrid
        events={search.events}
        isLoading={search.isLoading}
        isInitialLoad={search.isInitialLoad}
        hasSearched={search.hasSearched}
        hasMore={search.hasMore}
        hasFilters={search.hasFilters}
        skeletonKeys={search.skeletonKeys}
        eventLinkPrefix={eventLinkPrefix}
        onLoadMore={search.loadMore}
        onClearFilters={search.clearFilters}
      />

      {showInfoCards && <EventInfoCards />}
    </div>
  );
}
