/**
 * Converts a string to a URL-safe slug, handling Spanish and English
 * accents, special characters, and spaces.
 *
 * Examples:
 *   slugify("Maratón de Tarragona")  → "maraton-de-tarragona"
 *   slugify("Triathlon Zürich!")     → "triathlon-zurich"
 *   slugify("  Hello   World  ")     → "hello-world"
 */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      // Decompose accented characters: "ó" → "o" + combining accent
      .normalize('NFD')
      // Strip combining diacritical marks (accents, tildes, etc.)
      .replace(/[\u0300-\u036f]/g, '')
      // ñ is not fully handled by NFD — replace explicitly
      .replace(/ñ/g, 'n')
      .replace(/ü/g, 'u')
      // Replace non-alphanumeric characters (except spaces and hyphens) with a space
      .replace(/[^a-z0-9\s-]/g, ' ')
      .trim()
      // Collapse whitespace and hyphens to a single hyphen
      .replace(/[\s-]+/g, '-')
  );
}

/**
 * Builds an SEO-friendly event slug from the event name, city, and year.
 *
 * @param name  Event name (e.g. "Maratón de Tarragona")
 * @param city  Event city (e.g. "Tarragona")
 * @param year  Event year as a number (e.g. 2026)
 * @param suffix Optional unique suffix appended when the base slug is taken
 *               (e.g. first 6 chars of the event UUID)
 *
 * Examples:
 *   generateEventSlug("Maratón Tarragona", "Tarragona", 2026)
 *     → "maraton-tarragona-tarragona-2026"
 *
 *   generateEventSlug("Maratón Tarragona", "Tarragona", 2026, "a3f9b2")
 *     → "maraton-tarragona-tarragona-2026-a3f9b2"
 */
export function generateEventSlug(
  name: string,
  city: string,
  year: number,
  suffix?: string,
): string {
  const parts = [slugify(name), slugify(city), String(year)];
  if (suffix) parts.push(suffix);
  return parts.filter(Boolean).join('-').replace(/-+/g, '-');
}
