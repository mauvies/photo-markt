import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/env.mjs';

/**
 * Serves pre-generated WebP thumbnails from Supabase Storage.
 * Path format: /api/thumb/photos/userId/eventId/thumbs/uuid/small.webp
 *              /api/thumb/photos/userId/eventId/thumbs/uuid/medium.webp
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
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const fullPath = pathSegments.join('/');

  // Validate structure — at minimum: photos/{uid}/{eventId}/thumbs/{uuid}/{size}.webp
  if (pathSegments.length < 6) {
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
