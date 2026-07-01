/**
 * Event-related database queries
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface Event {
  id: string;
  user_id: string;
  name: string;
  date: string;
  city: string;
  country: string;
  state: string;
  activity: string;
  is_public: boolean;
  share_code: string | null;
  slug: string | null;
  price_per_photo: number | null;
  watermark_enabled: boolean;
  is_collaborative: boolean;
  allow_guest_upload: boolean;
  require_upload_approval: boolean;
  type: 'solo' | 'collaborative' | 'organizer';
  organizer_fee_per_photo_cents: number | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface EventSummary {
  id: string;
  user_id: string;
  name: string;
  date: string;
  city: string;
  country: string;
  state: string;
  activity: string;
  is_public: boolean;
  share_code: string | null;
  slug: string | null;
  price_per_photo: number | null;
  watermark_enabled: boolean;
  is_collaborative: boolean;
  allow_guest_upload: boolean;
  require_upload_approval: boolean;
}

/**
 * Get all events for a user
 */
export async function getUserEvents(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<EventSummary[]> {
  const { data, error } = await supabase
    .from('events')
    .select(
      'id, name, date, city, country, activity, is_public, share_code, slug, price_per_photo, watermark_enabled, is_collaborative, allow_guest_upload, require_upload_approval',
    )
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .throwOnError();

  if (error) {
    throw new Error(`Failed to get user events: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as EventSummary[];
}

/**
 * Count events created by a user within an optional time window. Used by the
 * dashboard "events created" metric and its month-over-month trend.
 */
export async function getEventsCreatedCount(
  supabase: SupabaseServerClient,
  userId: string,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  let query = supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (startDate) query = query.gte('created_at', startDate);
  if (endDate) query = query.lte('created_at', endDate);

  const { count, error } = await query;

  if (error) {
    throw new Error(`Failed to count events: ${getErrorMessage(error)}`);
  }

  return count ?? 0;
}

/**
 * Get a single event by ID (with ownership check)
 */
export async function getEvent(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
): Promise<Event | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single()
    .throwOnError();

  if (error) {
    throw new Error(`Failed to get event: ${getErrorMessage(error)}`);
  }

  return data as Event | null;
}

/**
 * Check if an event exists and belongs to a user
 */
export async function eventExists(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    return false;
  }

  return true;
}

/**
 * Create a new event
 */
export async function createEvent(
  supabase: SupabaseServerClient,
  userId: string,
  eventData: {
    name: string;
    date: string;
    city: string;
    country: string;
    state: string;
    activity: string;
    is_public: boolean;
    share_code: string | null;
    slug?: string | null;
    price_per_photo: number | null;
    watermark_enabled: boolean;
    is_collaborative?: boolean;
    allow_guest_upload?: boolean;
    require_upload_approval?: boolean;
    type?: 'solo' | 'collaborative' | 'organizer';
    organizer_fee_per_photo_cents?: number | null;
    ai_matching_enabled?: boolean;
    contains_minors?: boolean;
    bib_detection_enabled?: boolean;
  },
): Promise<{ id: string }> {
  // Only include the newer columns when they actually carry a value. Lets
  // the insert succeed against environments where the
  // `add_organizer_event_type` migration hasn't been applied yet, as long as
  // the event being created doesn't depend on those columns.
  const {
    type,
    organizer_fee_per_photo_cents,
    ai_matching_enabled,
    contains_minors,
    bib_detection_enabled,
    ...rest
  } = eventData;
  const insertPayload: Record<string, unknown> = { user_id: userId, ...rest };
  if (type && type !== 'solo') insertPayload.type = type;
  if (organizer_fee_per_photo_cents !== null && organizer_fee_per_photo_cents !== undefined) {
    insertPayload.organizer_fee_per_photo_cents = organizer_fee_per_photo_cents;
  }
  // AI columns ship as part of the AWS Rekognition rollout — only include
  // them when explicitly set so this query still works against older
  // databases that haven't applied the migration.
  if (ai_matching_enabled !== undefined) insertPayload.ai_matching_enabled = ai_matching_enabled;
  if (contains_minors !== undefined) insertPayload.contains_minors = contains_minors;
  if (bib_detection_enabled !== undefined)
    insertPayload.bib_detection_enabled = bib_detection_enabled;

  const { data, error } = await supabase.from('events').insert(insertPayload).select('id').single();

  if (error || !data) {
    const msg = error ? getErrorMessage(error) : 'Unknown error';
    // Pinpoint the most common deployment-blocker so the message is
    // actionable instead of a raw PostgREST error.
    if (
      /organizer_fee_per_photo_cents|column.*"type"|schema cache/i.test(msg) &&
      type === 'organizer'
    ) {
      throw new Error(
        'Organizer events require the latest database migration. Run `supabase db push` (or apply 20260511000000_add_organizer_event_type.sql) and reload the PostgREST schema cache.',
      );
    }
    throw new Error(`Failed to create event: ${msg}`);
  }

  return { id: data.id };
}

/**
 * Get an event by share code (public access)
 */
export async function getEventByShareCode(
  supabase: SupabaseServerClient,
  shareCode: string,
): Promise<Event | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('share_code', shareCode)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Event;
}

/**
 * Get a public event by its SEO-friendly slug (public access)
 */
export async function getEventBySlug(
  supabase: SupabaseServerClient,
  slug: string,
): Promise<Event | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('slug', slug)
    .eq('is_public', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as Event;
}

/**
 * Search public events with filters
 */
export async function searchPublicEvents(
  supabase: SupabaseServerClient,
  filters: {
    searchText?: string;
    activities?: string[];
    cities?: string[];
    countries?: string[];
    dateFrom?: string;
    dateTo?: string;
    sortBy?: 'date_asc' | 'date_desc' | 'name_asc' | 'name_desc';
    limit?: number;
    offset?: number;
    photographerQuery?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
  },
): Promise<{ events: EventSummary[]; total: number }> {
  // Photographer filter: resolve matching user IDs before building the main query
  let photographerUserIds: string[] | null = null;
  if (filters.photographerQuery?.trim()) {
    const term = `%${filters.photographerQuery.trim()}%`;
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id')
      .or(`username.ilike.${term},display_name.ilike.${term}`);
    photographerUserIds = (profileData ?? []).map((p: { id: string }) => p.id);
    if (photographerUserIds.length === 0) {
      return { events: [], total: 0 };
    }
  }

  let query = supabase
    .from('events')
    .select(
      'id, user_id, name, date, city, country, state, activity, is_public, share_code, slug, price_per_photo, watermark_enabled, is_collaborative, allow_guest_upload, require_upload_approval',
      { count: 'exact' },
    )
    .eq('is_public', true)
    .is('deleted_at', null);

  if (photographerUserIds) {
    query = query.in('user_id', photographerUserIds);
  }

  // Radius bounding-box + text search
  // When lat/lng/radiusKm are provided, use a bounding-box OR text-fallback approach:
  //   • Events WITH coordinates: included if inside the bounding box
  //   • Events WITHOUT coordinates: included if they match the city text (fallback)
  const hasRadius =
    filters.lat !== undefined &&
    filters.lng !== undefined &&
    filters.radiusKm !== undefined &&
    filters.radiusKm > 0;

  if (
    hasRadius &&
    filters.lat !== undefined &&
    filters.lng !== undefined &&
    filters.radiusKm !== undefined
  ) {
    const deltaLat = filters.radiusKm / 111;
    const deltaLng = filters.radiusKm / (111 * Math.cos((filters.lat * Math.PI) / 180));
    const latMin = (filters.lat - deltaLat).toFixed(6);
    const latMax = (filters.lat + deltaLat).toFixed(6);
    const lngMin = (filters.lng - deltaLng).toFixed(6);
    const lngMax = (filters.lng + deltaLng).toFixed(6);

    // For text fallback: extract city part from searchText, or fall back to the
    // explicit cities filter (covers the case where the caller matched a city by
    // name and passed it via `cities` rather than `searchText`).
    const rawText = filters.searchText?.trim() ?? '';
    const cityPartFromText = rawText.includes(', ') ? rawText.split(', ')[0] : rawText;
    const cityPart = cityPartFromText || (filters.cities?.length ? filters.cities[0] : '');

    if (cityPart) {
      // OR: within bounding box (events with coords) | city text match (events without coords)
      query = query.or(
        `and(lat.gte.${latMin},lat.lte.${latMax},lng.gte.${lngMin},lng.lte.${lngMax}),` +
          `and(lat.is.null,city.ilike.%${cityPart}%)`,
      );
    } else {
      // No text — apply bounding box only
      query = query
        .gte('lat', Number(latMin))
        .lte('lat', Number(latMax))
        .gte('lng', Number(lngMin))
        .lte('lng', Number(lngMax));
    }
  } else if (filters.searchText?.trim()) {
    // Text search across name, city, country.
    // Split on ", " so that "Barcelona, Spain" searches each token separately
    // without needing PostgREST quoted-value syntax (which causes parse errors).
    const terms = filters.searchText.trim().split(/,\s*/).filter(Boolean);
    const conditions = terms
      .flatMap((t) => {
        const pat = `%${t.trim()}%`;
        return [`name.ilike.${pat}`, `city.ilike.${pat}`, `country.ilike.${pat}`];
      })
      .join(',');
    query = query.or(conditions);
  }

  // Activity filter
  if (filters.activities && filters.activities.length > 0) {
    query = query.in('activity', filters.activities);
  }

  // City filter — skipped when bounding box is active because the city name is
  // already incorporated into the geo-OR fallback above (applying it again as an
  // AND would exclude events that have coordinates but a different city spelling,
  // and would always exclude events without lat/lng coordinates).
  if (!hasRadius && filters.cities && filters.cities.length > 0) {
    query = query.in('city', filters.cities);
  }

  // Country filter
  if (filters.countries && filters.countries.length > 0) {
    query = query.in('country', filters.countries);
  }

  // Date range filter
  if (filters.dateFrom) {
    query = query.gte('date', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('date', filters.dateTo);
  }

  // Sort
  const sortBy = filters.sortBy || 'date_desc';
  switch (sortBy) {
    case 'date_asc':
      query = query.order('date', { ascending: true });
      break;
    case 'date_desc':
      query = query.order('date', { ascending: false });
      break;
    case 'name_asc':
      query = query.order('name', { ascending: true });
      break;
    case 'name_desc':
      query = query.order('name', { ascending: false });
      break;
  }

  // Pagination
  const limit = filters.limit || 20;
  const offset = filters.offset || 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('Search events error:', error);
    throw new Error(`Failed to search events: ${getErrorMessage(error)}`);
  }

  return {
    events: (data ?? []) as EventSummary[],
    total: count ?? 0,
  };
}

/**
 * Get unique values for filters (cities, countries)
 */
export async function getEventFilterOptions(supabase: SupabaseServerClient): Promise<{
  cities: string[];
  countries: string[];
}> {
  const { data, error } = await supabase
    .from('events')
    .select('city, country')
    .eq('is_public', true)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to get filter options: ${getErrorMessage(error)}`);
  }

  const cities = new Set<string>();
  const countries = new Set<string>();

  (data ?? []).forEach((event) => {
    if (event.city) cities.add(event.city);
    if (event.country) countries.add(event.country);
  });

  return {
    cities: Array.from(cities).sort(),
    countries: Array.from(countries).sort(),
  };
}

/**
 * Update an event
 */
export async function updateEvent(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
  eventData: {
    name?: string;
    date?: string;
    city?: string;
    country?: string;
    state?: string | null;
    activity?: string;
    is_public?: boolean;
    share_code?: string | null;
    price_per_photo?: number | null;
    watermark_enabled?: boolean;
    is_collaborative?: boolean;
    allow_guest_upload?: boolean;
    require_upload_approval?: boolean;
    ai_matching_enabled?: boolean;
    bib_detection_enabled?: boolean;
  },
): Promise<void> {
  // Verify event belongs to user and is not deleted
  const exists = await eventExists(supabase, eventId, userId);
  if (!exists) {
    throw new Error('Event not found or access denied');
  }

  const { error } = await supabase
    .from('events')
    .update(eventData)
    .eq('id', eventId)
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to update event: ${getErrorMessage(error)}`);
  }
}

export interface TopEventCandidate {
  id: string;
  user_id: string;
  name: string;
  date: string;
  city: string;
  country: string;
  activity: string;
  slug: string | null;
  price_per_photo: number | null;
  created_at: string;
}

/**
 * Fetch recent public events as candidates for the home page "Top Events" section.
 * Returns a larger set than needed so the caller can score and filter down.
 */
export async function getTopEvents(
  supabase: SupabaseServerClient,
  candidateLimit = 50,
): Promise<TopEventCandidate[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id, user_id, name, date, city, country, activity, slug, price_per_photo, created_at')
    .eq('is_public', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(candidateLimit);

  if (error) throw new Error(`Failed to get top event candidates: ${getErrorMessage(error)}`);
  return (data ?? []) as TopEventCandidate[];
}

/**
 * Delete an event (soft delete - sets deleted_at timestamp)
 * This preserves the event data for historical metrics and analytics
 */
export async function deleteEvent(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
): Promise<void> {
  // Verify event belongs to user and is not already deleted
  const exists = await eventExists(supabase, eventId, userId);
  if (!exists) {
    throw new Error('Event not found or access denied');
  }

  const { error } = await supabase
    .from('events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', eventId)
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to delete event: ${getErrorMessage(error)}`);
  }
}
