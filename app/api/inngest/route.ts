/**
 * Inngest webhook handler. Inngest cloud POSTs here to invoke each
 * registered function; the SDK also exposes GET for the introspection
 * page used by the local Inngest Dev Server.
 *
 * `signingKey` is auto-loaded from `INNGEST_SIGNING_KEY` (validated in
 * `env.mjs`), so we don't pass it explicitly.
 *
 * Add a new Inngest function by importing it here and appending to the
 * `functions` array — that's the single source of truth.
 */

import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { backfillEventIndexing } from '@/lib/inngest/functions/backfill-event-indexing';
import { cleanupOnEventDelete } from '@/lib/inngest/functions/cleanup-on-event-delete';
import { cleanupOrphanedStorageFiles } from '@/lib/inngest/functions/cleanup-orphaned-storage';
import { disableEventIndexing } from '@/lib/inngest/functions/disable-event-indexing';
import { indexPhotoFaces } from '@/lib/inngest/functions/index-photo-faces';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    indexPhotoFaces,
    backfillEventIndexing,
    disableEventIndexing,
    cleanupOnEventDelete,
    cleanupOrphanedStorageFiles,
  ],
});
