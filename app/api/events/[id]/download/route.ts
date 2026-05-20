import { once } from 'node:events';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import { type NextRequest, NextResponse } from 'next/server';
import { getPurchasedPhotoIdsForEvent } from '@/database/queries/orders';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getClientIp, rateLimit, retryAfterSeconds } from '@/lib/rate-limit';

// archiver is a Node library — must run on the Node runtime, not edge.
export const runtime = 'nodejs';
// Streaming many high-res originals into a ZIP takes time; allow up to 60s.
// The 50-photo cap below keeps a single request well within that budget.
export const maxDuration = 60;

const MAX_PHOTOS = 50;

type PhotoRow = { id: string; original_url: string | null; original_filename: string | null };
type DownloadablePhoto = { id: string; original_url: string; original_filename: string | null };

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, { status, headers });
}

/** De-dupes archive entry names so two photos with the same filename don't clobber. */
function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const dot = base.lastIndexOf('.');
    name = dot > 0 ? `${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${base}-${n}`;
    n += 1;
  }
  used.add(name);
  return name;
}

/**
 * POST /api/events/[id]/download — streams a ZIP of the requested event photos.
 *
 * Legitimately an API route (not a Server Action): it returns a streamed file
 * response. Permission is enforced here, server-side, and never trusted from
 * the client:
 *   - the event owner may download any of their event's originals;
 *   - a free event's photos are downloadable by anyone (incl. logged-out guests);
 *   - on a paid event, only the photos the authenticated user has purchased.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  // ── Parse + validate the body ──────────────────────────────────────────
  let photoIds: string[];
  try {
    const body = (await req.json()) as { photoIds?: unknown };
    photoIds = Array.isArray(body.photoIds)
      ? body.photoIds.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return jsonError('Invalid request body', 400);
  }
  if (photoIds.length === 0) return jsonError('No photos selected', 400);
  if (photoIds.length > MAX_PHOTOS) {
    return jsonError(`A single download is limited to ${MAX_PHOTOS} photos`, 400);
  }

  // ── Auth (the session is absent for guests on free events) ─────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Rate limit ─────────────────────────────────────────────────────────
  const rl = await rateLimit({
    key: `event-download:${user?.id ?? getClientIp(req.headers)}`,
    limit: 30,
    windowSec: 3600,
  });
  if (!rl.ok) {
    return jsonError('Too many requests', 429, { 'Retry-After': String(retryAfterSeconds(rl)) });
  }

  // ── Load the event + the requested photos (service role) ───────────────
  const { data: event } = await supabaseAdmin
    .from('events')
    .select('id, user_id, price_per_photo')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!event) return jsonError('Event not found', 404);

  const { data: photoRows } = await supabaseAdmin
    .from('photos')
    .select('id, original_url, original_filename')
    .eq('event_id', eventId)
    .in('id', photoIds)
    .is('deleted_at', null);
  // Only photos that genuinely belong to this event survive; a client-supplied
  // id for another event's photo is silently dropped here.
  const photos: DownloadablePhoto[] = ((photoRows ?? []) as PhotoRow[]).filter(
    (p): p is DownloadablePhoto => typeof p.original_url === 'string' && p.original_url.length > 0,
  );

  // ── Permission filter (authoritative) ──────────────────────────────────
  const isOwner = user != null && user.id === event.user_id;
  const isFree = event.price_per_photo == null;
  let allowed: DownloadablePhoto[];
  if (isOwner || isFree) {
    allowed = photos;
  } else if (user) {
    const purchased = await getPurchasedPhotoIdsForEvent(supabaseAdmin, user.id, eventId);
    allowed = photos.filter((p) => purchased.has(p.id));
  } else {
    // Guest on a paid event — nothing is downloadable.
    allowed = [];
  }
  if (allowed.length === 0) return jsonError('No downloadable photos in the selection', 403);

  // ── Stream a ZIP ───────────────────────────────────────────────────────
  // `store` (no compression): JPEGs are already compressed, so storing is
  // faster and lighter on CPU.
  const archive = archiver('zip', { store: true });
  archive.on('error', (err) => console.error('[event-download] archive error', err));

  // Build in the background. One photo is fetched and zipped at a time, and
  // we wait for archiver to flush each entry before fetching the next — peak
  // memory stays at roughly a single original, not the whole selection.
  // `void`: intentionally not awaited — the response streams as this runs.
  void (async () => {
    const used = new Set<string>();
    for (const photo of allowed) {
      try {
        const { data: signed } = await supabaseAdmin.storage
          .from('photos')
          .createSignedUrl(photo.original_url, 600);
        if (!signed?.signedUrl) continue;
        const res = await fetch(signed.signedUrl);
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        const base =
          photo.original_filename || photo.original_url.split('/').pop() || `${photo.id}.jpg`;
        const entryProcessed = once(archive, 'entry');
        archive.append(buffer, { name: uniqueName(base, used) });
        await entryProcessed;
      } catch (err) {
        // Skip a photo that fails to fetch — don't fail the whole ZIP.
        console.error('[event-download] skipped photo', photo.id, err);
      }
    }
    archive.finalize().catch((err) => console.error('[event-download] finalize failed', err));
  })();

  return new Response(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="event-photos.zip"',
      'Cache-Control': 'no-store',
    },
  });
}
