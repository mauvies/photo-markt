// Sentry init for the Node.js server runtime. Loaded by `instrumentation.ts`.
// No-op without SENTRY_DSN (see buildSentryOptions).
import * as Sentry from '@sentry/nextjs';
import { buildSentryOptions } from '@/lib/observability/sentry';

Sentry.init(buildSentryOptions(process.env.SENTRY_DSN, process.env.NODE_ENV));
