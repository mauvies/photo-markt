/**
 * Inngest client singleton. Used by server actions to emit events and by
 * `app/api/inngest/route.ts` to serve registered functions.
 *
 * `eventKey` and `signingKey` are picked up automatically from
 * `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` env vars by the SDK — no
 * need to pass them through here. We still validate their presence via
 * `env.mjs` so the build fails loudly if either is missing.
 */

import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'photomarkt' });
