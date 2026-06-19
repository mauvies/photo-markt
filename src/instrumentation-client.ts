// Sentry init for the browser. Next.js loads this on the client before app code.
// No-op without NEXT_PUBLIC_SENTRY_DSN (see buildSentryOptions). Session replay
// is intentionally not enabled — it can capture on-screen PII (selfies, names).
import * as Sentry from '@sentry/nextjs';
import { buildSentryOptions } from '@/lib/observability/sentry';

Sentry.init(buildSentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NODE_ENV));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
