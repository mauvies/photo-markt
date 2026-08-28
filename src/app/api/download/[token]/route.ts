import { once } from 'node:events';
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { type NextRequest, NextResponse } from 'next/server';
import { getDownloadTokenByToken } from '@/database/queries/download-tokens';
import { getGuestOrderWithItems } from '@/database/queries/guest-orders';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getClientIp, rateLimit, retryAfterSeconds } from '@/lib/rate-limit';

// Node runtime (archiver needs it) is the default; not pinned, because that
// conflicts with the `experimental.useCache` config. Streaming originals takes
// time, so allow the same 60s as the event ZIP.
export const maxDuration = 60;

/** Same ceiling as the event ZIP: keeps one request inside `maxDuration`. */
const MAX_PHOTOS = 50;

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, { status, headers });
}

/** De-dupes entry names so two photos with the same filename don't clobber. */
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
 * GET /api/download/[token] — every photo in one guest purchase, as a ZIP.
 *
 * The guest sibling of `/api/events/[id]/download`. That one authenticates a
 * session and filters to what the user bought; here **the token IS the
 * credential** — the buyer never had an account — so the whole gate is:
 * the token exists, it has not expired, and its order is `completed`. The set is
 * then the order's own items and nothing else, which is why no id from the
 * request is ever used to select photos.
 *
 * ⚠️ **No `deleted_at` filter on the photo read, deliberately.** A sold photo is
 * soft-deleted rather than destroyed precisely so the buyer keeps it (T-142);
 * adding the filter here would take a paid-for photo away the moment the
 * photographer tidied up their event. Same rule the event ZIP follows.
 *
 * Rate-limited per IP: the token is unguessable, but a leaked link should not be
 * a way to make us restream 50 originals on a loop.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const limit = await rateLimit({
    key: `guest-zip:${getClientIp(request.headers)}`,
    limit: 20,
    windowSec: 3600,
  });
  if (!limit.ok) {
    return jsonError('Too many requests', 429, {
      'Retry-After': String(retryAfterSeconds(limit)),
    });
  }

  const downloadToken = await getDownloadTokenByToken(supabaseAdmin, token);
  // One answer for "no such token" and "expired": a probe learns nothing about
  // which it was.
  if (!downloadToken?.guest_order_id) return jsonError('Not found', 404);
  if (new Date(downloadToken.expires_at) < new Date()) return jsonError('Not found', 404);

  const guestOrder = await getGuestOrderWithItems(supabaseAdmin, downloadToken.guest_order_id);
  if (guestOrder?.status !== 'completed') return jsonError('Not found', 404);

  const photoIds = guestOrder.items.slice(0, MAX_PHOTOS).map((item) => item.photo_id);
  if (photoIds.length === 0) return jsonError('No downloadable photos', 404);

  const { data: photos } = await supabaseAdmin
    .from('photos')
    .select('id, original_url, original_filename')
    .in('id', photoIds);

  const downloadable = (photos ?? []).filter(
    (photo): photo is { id: string; original_url: string; original_filename: string | null } =>
      Boolean(photo.original_url),
  );
  if (downloadable.length === 0) return jsonError('No downloadable photos', 404);

  // `store`: JPEGs are already compressed, so skipping deflate is faster and
  // cheaper on CPU for the same output size.
  const archive = new ZipArchive({ store: true });
  archive.on('error', (err) => console.error('[guest-download] archive error', err));

  // Streamed as it builds. One photo is fetched and flushed at a time, so peak
  // memory stays around a single original rather than the whole order.
  void (async () => {
    const used = new Set<string>();
    for (const photo of downloadable) {
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
        // Skip one bad photo rather than failing the whole download.
        console.error('[guest-download] skipped photo', photo.id, err);
      }
    }
    archive.finalize().catch((err) => console.error('[guest-download] finalize failed', err));
  })();

  return new Response(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="photo-markt-photos.zip"',
      'Cache-Control': 'no-store',
    },
  });
}
