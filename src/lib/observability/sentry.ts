/**
 * Shared, pure builder for the options passed to `Sentry.init` on the server,
 * edge, and client runtimes.
 *
 * Gating: with no DSN the SDK is fully disabled (`enabled: false`) — it never
 * opens a transport and never sends an event. This keeps local dev, the test
 * run, and preview deploys (none of which have a DSN) completely silent, and is
 * the behaviour the gating test locks in.
 *
 * PII: `sendDefaultPii` is forced to `false`. Image buffers and selfies are
 * already kept out of error output by `safeCall` (src/lib/safe-call.ts); leaving
 * default PII off means request bodies, headers, and IPs aren't attached either.
 */
export interface SentryInitOptions {
  dsn: string | undefined;
  enabled: boolean;
  environment: string | undefined;
  tracesSampleRate: number;
  sendDefaultPii: false;
}

export function buildSentryOptions(
  dsn: string | undefined,
  environment?: string,
): SentryInitOptions {
  const trimmed = dsn?.trim();
  const hasDsn = Boolean(trimmed);

  return {
    // A blank/whitespace DSN collapses to `undefined` so the SDK treats it as
    // "not configured" rather than trying (and failing) to parse it.
    dsn: hasDsn ? trimmed : undefined,
    enabled: hasDsn,
    environment,
    // Low, fixed trace sampling — error capture is the goal; tracing is a bonus
    // and only runs at all when a DSN enables the SDK.
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  };
}
