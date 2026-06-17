import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { getPhotoFaceBoxesByStoragePath } from '@/database/queries/rekognition';
import { env } from '@/env.mjs';
import { addWatermarkToImage, buildWatermarkErrorPlaceholder, type FaceBox } from '@/lib/watermark';

/**
 * API route to serve watermarked images — accessible without authentication.
 * Path format: /api/watermark/photos/userId/eventId/filename
 *
 * Security posture: this endpoint is fail-CLOSED. If anything goes wrong
 * (storage download fails, watermarking throws, config missing) we serve a
 * generic placeholder image — never the original. The original photo is
 * payment-gated; falling back to the un-watermarked source on error would
 * silently bypass that gate.
 */
async function serveErrorPlaceholder(status: number): Promise<NextResponse> {
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
      },
    });
  } catch (placeholderErr) {
    // The placeholder itself failed (Sharp broken? extreme edge case).
    // Fall back to a plain text 502 — still better than the original image.
    console.error('[watermark-error] placeholder generation failed', placeholderErr);
    return new NextResponse('Preview unavailable', {
      status,
      headers: { 'Cache-Control': 'no-store' },
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
  _request: NextRequest,
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

    const { data: imageData, error: downloadError } = await supabase.storage
      .from('photos')
      .download(fullPath);

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

    // Best-effort: anchor a watermark over a face if this photo has indexed
    // faces. Any failure here must NOT break the preview — degrade to tile-only.
    let faceBoxes: FaceBox[] = [];
    try {
      faceBoxes = await getPhotoFaceBoxesByStoragePath(supabase, fullPath);
    } catch (faceErr) {
      logWatermarkError('face box lookup failed (degrading to tile-only)', {
        path: fullPath,
        error: faceErr,
        status: 200,
      });
    }

    let watermarkedBuffer: Buffer;
    try {
      watermarkedBuffer = await addWatermarkToImage(imageBuffer, faceBoxes);
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
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (error) {
    logWatermarkError('unhandled', { path: fullPath, error, status: 502 });
    return serveErrorPlaceholder(502);
  }
}
