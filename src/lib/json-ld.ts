/**
 * Stringify a JSON-LD payload for embedding inside an inline `<script>` tag.
 *
 * `JSON.stringify` does not HTML-escape, so a user-controlled field containing
 * `</script>` would break out of the script block and execute attacker JS. We
 * escape `<`, `>`, and `&` plus the U+2028/U+2029 line separators that some
 * older JS parsers treat as line terminators inside string literals.
 */
export function stringifyJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
