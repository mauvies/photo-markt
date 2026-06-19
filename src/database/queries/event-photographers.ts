/**
 * Queries for the event_photographers join table — invite-only membership
 * model for "organizer" event types. The organizer (event owner) invites
 * specific platform photographers; each photographer accepts/declines.
 * Accepted rows grant upload permission for the event.
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

// PostgREST returns this when the schema cache hasn't been reloaded after a
// migration adds the table. We treat it as "feature not yet provisioned" and
// fall back to empty results so the rest of the app keeps working.
function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  return (
    e.code === 'PGRST205' || /could not find the table .*event_photographers/i.test(e.message ?? '')
  );
}

export type EventPhotographerStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface EventPhotographerRow {
  id: string;
  event_id: string;
  photographer_id: string;
  status: EventPhotographerStatus;
  invited_by: string;
  invited_at: string;
  responded_at: string | null;
}

export interface EventPhotographerWithProfile extends EventPhotographerRow {
  profile: {
    id: string;
    username: string | null;
    slug: string | null;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

export interface PendingInvitationForPhotographer extends EventPhotographerRow {
  event: {
    id: string;
    name: string;
    date: string | null;
    city: string | null;
    user_id: string;
    organizer: {
      display_name: string | null;
      username: string | null;
      slug: string | null;
    } | null;
  } | null;
}

/**
 * Insert a new pending invitation. Caller must be the event owner (the RLS
 * policy enforces this; callers in server actions also do an explicit check
 * for clearer error messages).
 */
export async function inviteEventPhotographer(
  supabase: SupabaseServerClient,
  params: { eventId: string; photographerId: string; organizerId: string },
): Promise<EventPhotographerRow> {
  const { data, error } = await supabase
    .from('event_photographers')
    .insert({
      event_id: params.eventId,
      photographer_id: params.photographerId,
      invited_by: params.organizerId,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to invite photographer: ${error ? getErrorMessage(error) : 'unknown'}`);
  }
  return data as EventPhotographerRow;
}

/**
 * Photographer responds to one of their own pending invitations.
 * RLS gates this to status='pending' and to the photographer themselves.
 */
export async function respondToEventInvitation(
  supabase: SupabaseServerClient,
  params: {
    invitationId: string;
    photographerId: string;
    status: 'accepted' | 'declined';
  },
): Promise<EventPhotographerRow> {
  const { data, error } = await supabase
    .from('event_photographers')
    .update({ status: params.status, responded_at: new Date().toISOString() })
    .eq('id', params.invitationId)
    .eq('photographer_id', params.photographerId)
    .eq('status', 'pending')
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to respond to invitation: ${error ? getErrorMessage(error) : 'invitation not found or already responded'}`,
    );
  }
  return data as EventPhotographerRow;
}

/**
 * Organizer revokes (or removes) a photographer from their event.
 * - For pending invitations: hard-delete (the photographer hasn't engaged).
 * - For accepted invitations: flip status to 'revoked' so historical records
 *   (e.g. previously uploaded photos) keep their attribution.
 */
export async function revokeEventPhotographer(
  supabase: SupabaseServerClient,
  params: { invitationId: string; eventId: string; organizerId: string },
): Promise<void> {
  // Verify ownership + load current state.
  const { data: existing, error: loadError } = await supabase
    .from('event_photographers')
    .select('id, status, event_id')
    .eq('id', params.invitationId)
    .single();

  if (loadError || !existing) {
    throw new Error(`Invitation not found: ${loadError ? getErrorMessage(loadError) : 'unknown'}`);
  }
  if (existing.event_id !== params.eventId) {
    throw new Error('Invitation does not belong to the given event');
  }

  if (existing.status === 'pending') {
    const { error } = await supabase
      .from('event_photographers')
      .delete()
      .eq('id', params.invitationId);
    if (error) throw new Error(`Failed to delete invitation: ${getErrorMessage(error)}`);
    return;
  }

  const { error } = await supabase
    .from('event_photographers')
    .update({ status: 'revoked', responded_at: new Date().toISOString() })
    .eq('id', params.invitationId);
  if (error) throw new Error(`Failed to revoke membership: ${getErrorMessage(error)}`);
}

/**
 * Lists every photographer associated with an event, joined with their
 * profile data for display. Owner-side query.
 *
 * `event_photographers.photographer_id` FKs to `auth.users.id`, not
 * `public.profiles.id`, so PostgREST cannot auto-resolve a nested join.
 * We do the join manually in two queries.
 */
export async function getEventPhotographers(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<EventPhotographerWithProfile[]> {
  const { data, error } = await supabase
    .from('event_photographers')
    .select('id, event_id, photographer_id, status, invited_by, invited_at, responded_at')
    .eq('event_id', eventId)
    .order('invited_at', { ascending: false });

  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`Failed to list event photographers: ${getErrorMessage(error)}`);
  }

  const rows = (data ?? []) as EventPhotographerRow[];
  if (rows.length === 0) return [];

  const photographerIds = Array.from(new Set(rows.map((r) => r.photographer_id)));
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, slug, display_name, avatar_url')
    .in('id', photographerIds);

  if (profilesError) {
    throw new Error(`Failed to load photographer profiles: ${getErrorMessage(profilesError)}`);
  }

  const profileMap = new Map<string, EventPhotographerWithProfile['profile']>();
  for (const p of profiles ?? []) {
    profileMap.set(p.id as string, {
      id: p.id as string,
      username: (p.username as string | null) ?? null,
      slug: (p.slug as string | null) ?? null,
      display_name: (p.display_name as string | null) ?? null,
      avatar_url: (p.avatar_url as string | null) ?? null,
    });
  }

  return rows.map((r) => ({
    ...r,
    profile: profileMap.get(r.photographer_id) ?? null,
  }));
}

/**
 * Pending invitations to surface in the photographer's events list.
 *
 * `events.user_id` FKs to `auth.users`, not `public.profiles`, so PostgREST
 * can't auto-resolve a join from event → organizer profile. We do the joins
 * manually in three queries: invitations, events, organizer profiles.
 */
export async function getPendingInvitationsForPhotographer(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<PendingInvitationForPhotographer[]> {
  const { data, error } = await supabase
    .from('event_photographers')
    .select('id, event_id, photographer_id, status, invited_by, invited_at, responded_at')
    .eq('photographer_id', photographerId)
    .eq('status', 'pending')
    .order('invited_at', { ascending: false });

  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`Failed to list pending invitations: ${getErrorMessage(error)}`);
  }

  const rows = (data ?? []) as EventPhotographerRow[];
  if (rows.length === 0) return [];

  const eventIds = Array.from(new Set(rows.map((r) => r.event_id)));
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, date, city, user_id')
    .in('id', eventIds);

  if (eventsError) {
    throw new Error(`Failed to load events for invitations: ${getErrorMessage(eventsError)}`);
  }

  const ownerIds = Array.from(new Set((events ?? []).map((e) => e.user_id as string)));
  const { data: organizers, error: organizersError } = await supabase
    .from('profiles')
    .select('id, display_name, username, slug')
    .in('id', ownerIds);

  if (organizersError) {
    throw new Error(`Failed to load organizer profiles: ${getErrorMessage(organizersError)}`);
  }

  type Organizer = NonNullable<PendingInvitationForPhotographer['event']>['organizer'];
  const organizerMap = new Map<string, Organizer>();
  for (const org of organizers ?? []) {
    organizerMap.set(org.id as string, {
      display_name: (org.display_name as string | null) ?? null,
      username: (org.username as string | null) ?? null,
      slug: (org.slug as string | null) ?? null,
    });
  }

  const eventMap = new Map<string, PendingInvitationForPhotographer['event']>();
  for (const e of events ?? []) {
    const userId = e.user_id as string;
    eventMap.set(e.id as string, {
      id: e.id as string,
      name: e.name as string,
      date: (e.date as string | null) ?? null,
      city: (e.city as string | null) ?? null,
      user_id: userId,
      organizer: organizerMap.get(userId) ?? null,
    });
  }

  return rows.map((r) => ({
    ...r,
    event: eventMap.get(r.event_id) ?? null,
  }));
}

/**
 * Hot-path check: is the given user an accepted contributor for this event?
 * Used by the upload action's authorization guard.
 */
export async function isApprovedEventPhotographer(
  supabase: SupabaseServerClient,
  params: { eventId: string; photographerId: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from('event_photographers')
    .select('id')
    .eq('event_id', params.eventId)
    .eq('photographer_id', params.photographerId)
    .eq('status', 'accepted')
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return false;
    throw new Error(`Failed to check membership: ${getErrorMessage(error)}`);
  }
  return !!data;
}
