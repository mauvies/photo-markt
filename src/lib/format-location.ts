/**
 * Joins an event's city / state / country into a single human-readable
 * location string, e.g. "Barcelona, Catalonia, Spain" (T-107).
 *
 * - Empty parts are skipped, so a legacy event with only `city` populated
 *   (state/country still '') renders exactly as before.
 * - Consecutive duplicate parts are collapsed (city === state, or a legacy
 *   `city` that already reads "Barcelona, Spain" followed by an empty country)
 *   so the result never repeats a name.
 */
export function formatEventLocation(parts: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [parts.city, parts.state, parts.country]) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.join(', ');
}
