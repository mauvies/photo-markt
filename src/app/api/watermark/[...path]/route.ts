import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { getPreviewPolicyByStoragePath, type PreviewPolicy } from '@/database/queries/photos';
import { env } from '@/env.mjs';
import { getClientIp, rateLimit, retryAfterSeconds } from '@/lib/rate-limit';
import { generateThumbnail } from '@/lib/thumbnails';
import { addWatermarkToImage, buildWatermarkErrorPlaceholder } from '@/lib/watermark';

// Bound the request so a hung Sharp encode (or a slow Supabase download) can't
// bill open-ended serverless time. A single watermark is normally sub-second;
// 15s is generous headroom without leaving a stuck request running for minutes.
export const maxDuration = 15;

// Per-IP hourly cap. Each unique path is a fresh CDN miss that forces one
// Supabase download + one Sharp encode, so enumerating paths amplifies egress
// and CPU without bound. Cached edge hits never reach the function, so only
// misses count against this. In steady state the grid is served by the baked,
// immutable /api/thumb thumbnails (T-093) — this route is only the fallback for
// the transient pre-bake window, so normal volume is low. The cap is sized to
// absorb a large gallery scrolled entirely during that window; past it we serve
// the placeholder tile (not a hard error), so the limit degrades gracefully.
const WATERMARK_RATE_LIMIT = { limit: 600, windowSec: 3600 } as const;

/**
 * API route to serve protected photo previews — accessible without
 * authentication. Path format: /api/watermark/photos/userId/eventId/filename
 *
 * The treatment is decided server-side from the photo's event (T-133):
 * watermarked events get the tiled watermark pipeline; events that sell
 * without a visible mark get a clean medium-budget downscale (matching their
 * baked public thumbnail). Either way the full-resolution original never
 * leaves this route.
 *
 * Security posture: this endpoint is fail-CLOSED. If anything goes wrong
 * (storage download fails, policy lookup fails, watermarking throws, config
 * missing) we serve the watermark pipeline or a generic placeholder image —
 * never the original. The original photo is payment-gated; falling back to
 * the un-watermarked source on error would silently bypass that gate.
 */
async function serveErrorPlaceholder(
  status: number,
  extraHeaders?: Record<string, string>,
): Promise<NextResponse> {
  try {
    const placeholder = await buildWatermarkErrorPlaceholder();
    return new NextResponse(new Uint8Array(placeholder), {
      status,
      headers: {
        'Content-Type': 'image/jpeg',
        // Don't poison the CDN with the placeholder — if the underlying
        // problem is transient (DB hiccup, cold start), the next request
        // should retry rather than serve placeholder for 24h.
        'Cache-Control': 'no-store, must-revalidate',
        ...extraHeaders,
      },
    });
  } catch (placeholderErr) {
    // The placeholder itself failed (Sharp broken? extreme edge case).
    // Fall back to a plain text 502 — still better than the original image.
    console.error('[watermark-error] placeholder generation failed', placeholderErr);
    return new NextResponse('Preview unavailable', {
      status,
      headers: { 'Cache-Control': 'no-store', ...extraHeaders },
    });
  }
}

function logWatermarkError(
  reason: string,
  context: { path: string; error?: unknown; status: number },
): void {
  // Structured prefix makes this filterable in Vercel/CloudWatch logs and
  // alert-able in Sentry/Datadog without a wider integration.
  console.error('[watermark-error]', {
    reason,
    path: context.path,
    status: context.status,
    error:
      context.error instanceof Error
        ? { message: context.error.message, stack: context.error.stack }
        : context.error,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const fullPath = pathSegments.join('/');

  // Validate path structure — these errors are legitimately the caller's
  // fault, so 400 + no placeholder body is fine (broken `<img>` is OK here).
  if (pathSegments.length < 3) {
    return new NextResponse('Invalid path', { status: 400 });
  }
  if (
    pathSegments.some((s) => s === '..' || s === '.' || s === '' || s.includes('/')) ||
    fullPath.startsWith('/')
  ) {
    return new NextResponse('Invalid path', { status: 400 });
  }

  // Throttle before the expensive work (download + Sharp). Runs after path
  // validation so malformed requests never consume budget.
  const rl = await rateLimit({
    key: `watermark:${getClientIp(request.headers)}`,
    limit: WATERMARK_RATE_LIMIT.limit,
    windowSec: WATERMARK_RATE_LIMIT.windowSec,
  });
  if (!rl.ok) {
    // Serve the placeholder image (not a text body) so a throttled gallery
    // shows "preview unavailable" tiles rather than broken-image icons — same
    // fail-closed invariant as every other error path. `serveErrorPlaceholder`
    // already sets `no-store`, so the 429 is never cached (no CDN poisoning);
    // Retry-After tells the client when the window resets. Generating the tiny
    // placeholder is far cheaper than the download + full watermark it replaces,
    // so this doesn't reopen the amplification the limit closes.
    return serveErrorPlaceholder(429, { 'Retry-After': String(retryAfterSeconds(rl)) });
  }

  // From here on, any failure must serve the placeholder, not surface the
  // original image and not leak a JSON body that breaks `<img>` rendering.
  try {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey || serviceRoleKey.trim() === '') {
      logWatermarkError('missing SUPABASE_SERVICE_ROLE_KEY', { path: fullPath, status: 500 });
      return serveErrorPlaceholder(500);
    }

    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      logWatermarkError('missing NEXT_PUBLIC_SUPABASE_URL', { path: fullPath, status: 500 });
      return serveErrorPlaceholder(500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // T-133: pick the treatment from the event's OWN watermark policy + fetch
    // the indexed face boxes, looked up server-side by storage path — never
    // from anything the caller sends (this route is unauthenticated and
    // path-addressable, so a caller-chosen treatment would let anyone strip
    // the mark off a watermarked photo). The lookup is independent of the
    // download, so both run in parallel — no extra round trip of latency on
    // an already CDN-missed request. A lookup failure degrades to the
    // watermark treatment (fail closed) but is served `no-store`: a transient
    // DB hiccup must not pin the possibly-wrong treatment in the CDN for 24h.
    let policyLookupFailed = false;
    const [downloadResult, policy] = await Promise.all([
      supabase.storage.from('photos').download(fullPath),
      getPreviewPolicyByStoragePath(supabase, fullPath).catch((policyErr): PreviewPolicy => {
        policyLookupFailed = true;
        logWatermarkError('preview policy lookup failed (failing closed to watermark)', {
          path: fullPath,
          error: policyErr,
          status: 200,
        });
        return { watermarkEnabled: null, faceBoxes: [] };
      }),
    ]);

    const { data: imageData, error: downloadError } = downloadResult;
    if (downloadError || !imageData) {
      logWatermarkError('storage download failed', {
        path: fullPath,
        error: downloadError ?? 'no data',
        status: 404,
      });
      // Even a 404 gets the placeholder body so the gallery shows the
      // "preview unavailable" tile instead of a broken-image icon.
      return serveErrorPlaceholder(404);
    }

    const arrayBuffer = await imageData.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // An event positively known to sell WITHOUT a visible mark gets the exact
    // same treatment its baked public thumbnail serves in the steady state —
    // literally the same `generateThumbnail('medium')` the bake job runs, so
    // the pre-bake fallback can never expose more resolution than the public
    // /api/thumb URL. Watermarked or UNKNOWN policy (no bound photo row for
    // the path, lookup error) keeps the full watermark pipeline below — fail
    // closed. Cached shorter than the watermark branch (1h vs 24h): this is
    // the only body this route emits with no mark, so a later
    // watermark_enabled flip must stop serving clean copies quickly — the
    // URL is unversioned, there is no way to bust it.
    if (policy.watermarkEnabled === false) {
      try {
        const downscaledBuffer = await generateThumbnail(imageBuffer, 'medium');
        return new NextResponse(new Uint8Array(downscaledBuffer), {
          headers: {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          },
        });
      } catch (downscaleErr) {
        // Same invariant as the watermark branch: never fall back to
        // `imageBuffer` — the full-res original is payment-gated.
        logWatermarkError('clean downscale threw', {
          path: fullPath,
          error: downscaleErr,
          status: 502,
        });
        return serveErrorPlaceholder(502);
      }
    }

    let watermarkedBuffer: Buffer;
    try {
      // Blur every indexed face under the tile — face boxes came back with
      // the policy lookup (empty on lookup failure → tile-only, best-effort).
      watermarkedBuffer = await addWatermarkToImage(imageBuffer, policy.faceBoxes);
    } catch (watermarkErr) {
      // CRITICAL: never fall back to `imageBuffer` here — that would expose
      // the original, payment-gated photo to anyone who can hit the URL.
      logWatermarkError('addWatermarkToImage threw', {
        path: fullPath,
        error: watermarkErr,
        status: 502,
      });
      return serveErrorPlaceholder(502);
    }

    return new NextResponse(new Uint8Array(watermarkedBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        // A treatment picked on a FAILED policy lookup may be wrong (a
        // no-watermark event transiently rendered with tiles) — keep it out
        // of the CDN so the next request retries, mirroring the placeholder's
        // no-store rationale.
        'Cache-Control': policyLookupFailed
          ? 'no-store, must-revalidate'
          : 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (error) {
    logWatermarkError('unhandled', { path: fullPath, error, status: 502 });
    return serveErrorPlaceholder(502);
  }
}
