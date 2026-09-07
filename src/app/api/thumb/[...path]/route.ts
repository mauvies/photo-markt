import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/env.mjs';
import { getClientIp, rateLimit, retryAfterSeconds } from '@/lib/rate-limit';

// Bound the request so a slow Supabase download can't bill open-ended
// serverless time. Lower than the watermark route's 15s (T-221): this route
// runs no Sharp pipeline at all — one storage download and a passthrough — so
// anything past a few seconds is a stuck request, not a slow encode.
export const maxDuration = 10;

// Per-IP hourly cap. Only CDN misses reach the function, and the sizing below
// is a ceiling on LEGITIMATE misses, not a guess (T-221):
//   - one gallery page is `EVENT_GALLERY_PAGE_SIZE` (50) tiles = 50 `small`
//     misses on first paint;
//   - the worst single-viewer case is one whole event scrolled to the end —
//     `MAX_PHOTOS_PER_EVENT` is 5000 — plus a `medium` per lightbox open;
//   - so 6000/h clears that ceiling with headroom, and is 10x the watermark
//     route's 600 because the asymmetry is real: this is the steady-state hot
//     path for every grid tile, while watermark only serves the transient
//     pre-bake window.
// What it closes: thumb URLs carry a `?v=` cache-buster (T-078) and the CDN
// keys on the query string, so a caller holding ONE valid path can force an
// unbounded stream of misses — each an uncapped Supabase download — by varying
// it. Unguessable UUID paths stop enumeration; they do not stop replay.
const THUMB_RATE_LIMIT = { limit: 6000, windowSec: 3600 } as const;

/**
 * Serves pre-generated WebP thumbnails from Supabase Storage.
 * Path format: /api/thumb/userId/eventId/thumbs/uuid/small.webp
 *              /api/thumb/userId/eventId/thumbs/uuid/medium.webp
 * (segments map 1:1 to the storage object path inside the `photos` bucket)
 *
 * Security posture: fail-CLOSED. Any error returns 404 with no body —
 * galleries fall back to their existing source (watermark route or signed
 * original). We never serve the original image from this route.
 *
 * Cache headers: immutable + 1-year s-maxage so Vercel's edge CDN caches
 * each thumbnail indefinitely. Paths are content-addressed (uuid-based),
 * so a new upload always generates a new path — the CDN never serves stale.
 * This is the key egress reduction: Supabase is hit once per thumbnail;
 * all subsequent views are served from Vercel at zero Supabase egress.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const fullPath = pathSegments.join('/');

  // Validate structure — at minimum: {uid}/{eventId}/thumbs/{uuid}/{size}.webp
  if (pathSegments.length < 5) {
    return new NextResponse('Invalid path', { status: 400 });
  }
  if (
    pathSegments.some((s) => s === '..' || s === '.' || s === '' || s.includes('/')) ||
    fullPath.startsWith('/')
  ) {
    return new NextResponse('Invalid path', { status: 400 });
  }

  // Only serve files under the thumbs/ segment to prevent this route from
  // being used as a general-purpose storage proxy.
  if (!pathSegments.includes('thumbs')) {
    return new NextResponse('Invalid path', { status: 400 });
  }

  const lastSegment = pathSegments[pathSegments.length - 1];
  if (lastSegment !== 'small.webp' && lastSegment !== 'medium.webp') {
    return new NextResponse('Invalid path', { status: 400 });
  }

  // Throttle before touching storage. Runs after path validation so malformed
  // requests never consume budget. Over the cap we answer 429 — never this
  // route's fail-closed 404, which means "no such thumbnail" and would both
  // hide the throttling from the logs and read as a durable verdict to the
  // caller. `no-store` keeps the throttle out of the CDN, so the next window
  // serves the real image instead of a pinned error.
  const rl = await rateLimit({
    key: `thumb:${getClientIp(request.headers)}`,
    limit: THUMB_RATE_LIMIT.limit,
    windowSec: THUMB_RATE_LIMIT.windowSec,
  });
  if (!rl.ok) {
    return new NextResponse(null, {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds(rl)),
        'Cache-Control': 'no-store, must-revalidate',
      },
    });
  }

  try {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey || serviceRoleKey.trim() === '') {
      console.error('[thumb-error] missing SUPABASE_SERVICE_ROLE_KEY', { path: fullPath });
      return new NextResponse(null, { status: 404 });
    }

    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: blob, error } = await supabase.storage.from('photos').download(fullPath);

    if (error || !blob) {
      // Thumbnail not yet generated (pending) or failed — gallery falls back.
      return new NextResponse(null, { status: 404 });
    }

    const buffer = await blob.arrayBuffer();

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/webp',
        // immutable: path is content-addressed (uuid per upload).
        // s-maxage causes Vercel edge to cache it — all repeat views skip Supabase.
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('[thumb-error] unhandled', { path: fullPath, err });
    return new NextResponse(null, { status: 404 });
  }
}
