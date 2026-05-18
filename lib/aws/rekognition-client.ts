/**
 * AWS Rekognition v3 client singleton.
 *
 * Lazy-initialised so importing this module doesn't construct credentials
 * during build/static-analysis. Mirrors the pattern in
 * `database/supabase-admin.ts`.
 *
 * Used by `lib/aws/face-indexing.ts` and the Inngest workers in
 * `lib/inngest/functions/`. Never imported from client components.
 */

import { RekognitionClient } from '@aws-sdk/client-rekognition';
import { env } from '@/env.mjs';

let cachedClient: RekognitionClient | null = null;

export function getRekognitionClient(): RekognitionClient {
  if (cachedClient) return cachedClient;
  cachedClient = new RekognitionClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return cachedClient;
}
