// Validates a `next` redirect target. Returns the value if it's a safe internal
// path, otherwise null. Used by every login/signup/oauth-callback path to
// prevent open-redirect vulnerabilities.
//
// Why each rule exists:
// - Must start with '/'         → only same-origin paths are accepted
// - Reject '//' and '/\'        → both forms are protocol-relative URLs
// - Reject control chars / space → some browsers/proxies treat these specially
//   and they have no place in a real internal path
export function safeNext(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional reject of control chars
  if (/[\x00-\x1f\s]/.test(value)) return null;
  return value;
}

// Builds a `?next=...` query suffix (or empty string) safely.
export function nextQuerySuffix(
  value: string | null | undefined,
  leading: '?' | '&' = '?',
): string {
  const safe = safeNext(value);
  return safe ? `${leading}next=${encodeURIComponent(safe)}` : '';
}

/**
 * Rewrites a post-login `next` path so that public surfaces map to their
 * authenticated equivalents. Today the only mapping is:
 *
 *   /events/<param>(/...) → /dashboard/talent/events/<param>(/...)
 *
 * (The talent dashboard event detail route accepts the same UUID/slug as
 * the public route, so the param passes through unchanged.)
 *
 * Returns the input unchanged when no rule matches.
 */
export function rewritePostLoginNext(value: string): string {
  // /events                      → /dashboard/talent/events
  // /events/<param>              → /dashboard/talent/events/<param>
  // /events/<param>/anything     → /dashboard/talent/events/<param>/anything
  // /events?query                 → /dashboard/talent/events?query
  if (value === '/events') return '/dashboard/talent/events';
  const eventsPrefix = '/events/';
  if (value.startsWith(eventsPrefix)) {
    return `/dashboard/talent/events/${value.slice(eventsPrefix.length)}`;
  }
  if (value.startsWith('/events?') || value.startsWith('/events#')) {
    return `/dashboard/talent/events${value.slice('/events'.length)}`;
  }
  return value;
}
