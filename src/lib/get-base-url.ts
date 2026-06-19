/**
 * Get the base URL for the application
 * Used for generating watermark API URLs
 */
import { headers } from 'next/headers';

export async function getBaseUrl(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get('host');
  const protocol = headersList.get('x-forwarded-proto') || 'http';

  if (host) {
    return `${protocol}://${host}`;
  }

  // Fallback to environment variable or localhost
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  }

  return 'http://localhost:3000';
}
