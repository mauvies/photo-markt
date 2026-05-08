import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/env.mjs';
import { addWatermarkToImage } from '@/lib/watermark';

/**
 * API route to serve watermarked images — accessible without authentication.
 * Path format: /api/watermark/photos/userId/eventId/filename
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathSegments } = await params;
    const fullPath = pathSegments.join('/');

    // Validate path structure
    if (pathSegments.length < 3) {
      return new NextResponse('Invalid path', { status: 400 });
    }

    // Defense-in-depth — Supabase Storage already rejects out-of-bucket paths,
    // but reject obvious traversal/absolute paths early so we don't hand a
    // surprising input to the storage SDK.
    if (
      pathSegments.some((s) => s === '..' || s === '.' || s === '' || s.includes('/')) ||
      fullPath.startsWith('/')
    ) {
      return new NextResponse('Invalid path', { status: 400 });
    }

    // Use service role client for admin access to storage
    // Service role key is REQUIRED for storage access
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey || serviceRoleKey.trim() === '') {
      console.error(
        'Missing SUPABASE_SERVICE_ROLE_KEY - watermark API requires service role key for storage access',
      );
      return new NextResponse(
        JSON.stringify({
          error: 'Configuration error',
          message:
            'SUPABASE_SERVICE_ROLE_KEY is not configured. Service role key is required for watermark API to access storage.',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      console.error('Missing Supabase URL for watermark API');
      return new NextResponse('Configuration error', { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Download the original image from storage
    const { data: imageData, error: downloadError } = await supabase.storage
      .from('photos')
      .download(fullPath);

    if (downloadError || !imageData) {
      console.error('Failed to download image:', {
        path: fullPath,
        error: downloadError?.message,
      });
      return new NextResponse(
        JSON.stringify({
          error: 'Image not found',
          message: downloadError?.message || 'Unknown error',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Convert blob to buffer
    const arrayBuffer = await imageData.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Add watermark
    const watermarkedBuffer = await addWatermarkToImage(imageBuffer);

    // addWatermarkToImage always outputs JPEG regardless of input format
    // Return watermarked image with caching
    return new NextResponse(new Uint8Array(watermarkedBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400', // Cache for 24 hours
      },
    });
  } catch (error) {
    console.error('Watermark API error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
