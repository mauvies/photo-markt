// Next.js instrumentation hook. Runs once per server/edge runtime boot and wires
// up Sentry by loading the matching config. `onRequestError` forwards
// uncaught errors from nested React Server Components to Sentry.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
