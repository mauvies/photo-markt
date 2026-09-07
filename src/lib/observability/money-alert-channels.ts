/**
 * Are the money-incident alert channels actually live? (T-266)
 *
 * `reportMoneyIncident` has two durable channels — Sentry and an ops email —
 * and BOTH are optional, by a decision that is correct and stays: dev, tests
 * and previews must run without them, and `env.mjs` says in as many words that
 * "an optional alert recipient must never be able to take the site down". The
 * consequence is that production can lose both with nothing saying so, and then
 * every T-249 / T-253 / T-255 incident collapses to a `console.error` in the
 * Vercel logs — the exact thirteen-day blind spot the reporter exists to end.
 *
 * So the assertion lives here and is surfaced as a readiness check, not as a
 * boot-time requirement. Pure and input-taking on purpose: the probe reads the
 * validated env, the tests drive the decision directly.
 *
 * ⚠️ The email predicate is shared with the reporter rather than restated. A
 * probe that disagrees with the sender about what "configured" means is worse
 * than no probe: it would report a channel that never sends.
 */

/**
 * The recipient the reporter will actually send to, or `null`.
 *
 * `''` is a configured-but-empty value — `env.mjs` accepts it deliberately so
 * that staging a variable empty cannot 500 every route — and it means "not
 * set". Whitespace is treated the same; the schema should never produce it, and
 * a predicate that can't be fooled by it costs nothing.
 */
export function resolveMoneyAlertRecipient(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The Sentry SDK is inert without a DSN, and `SENTRY_DSN` is a plain optional
 * string, so `''` reaches here as a real value that configures nothing.
 */
export function isSentryConfigured(dsn: string | null | undefined): boolean {
  return Boolean(dsn?.trim());
}

export interface MoneyAlertChannelInputs {
  sentryDsn: string | null | undefined;
  alertEmail: string | null | undefined;
  /** `process.env.VERCEL_ENV` — `'production'` | `'preview'` | `'development'`. */
  vercelEnv: string | null | undefined;
}

export type MoneyAlertChannelVerdict =
  /** At least one channel will carry an incident. */
  | 'live'
  /** Neither channel is set, and that is expected here (dev, test, preview). */
  | 'unconfigured'
  /** Neither channel is set on the production deployment — the alarming case. */
  | 'unconfigured-in-production';

/**
 * One live channel is enough. The two are independent by design (Sentry groups
 * and dedupes, the email reaches a person), so requiring both would report a
 * problem where none exists — and a check that cries wolf is one people learn
 * to skip, the same reasoning `resolvePayoutReadiness` uses to keep a forecast
 * out of red.
 *
 * ⚠️ Production is detected from `VERCEL_ENV`, never `NODE_ENV`. `NODE_ENV` is
 * `'production'` for every preview deployment AND for a local `pnpm build`, so
 * keying on it would fail the check on machines and environments where having
 * no ops alerting is the correct state. The cost of that choice is that a
 * deployment target without `VERCEL_ENV` never asserts — acceptable while the
 * app is Vercel-only, and the reason this is written down.
 */
export function assessMoneyAlertChannels(
  inputs: MoneyAlertChannelInputs,
): MoneyAlertChannelVerdict {
  const hasChannel =
    isSentryConfigured(inputs.sentryDsn) || resolveMoneyAlertRecipient(inputs.alertEmail) !== null;
  if (hasChannel) return 'live';
  return inputs.vercelEnv === 'production' ? 'unconfigured-in-production' : 'unconfigured';
}
