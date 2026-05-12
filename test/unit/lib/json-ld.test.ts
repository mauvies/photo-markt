import { describe, expect, it } from 'vitest';
import { stringifyJsonLd } from '@/lib/json-ld';

describe('stringifyJsonLd', () => {
  it('escapes </script> so it cannot break out of an inline <script> block', () => {
    const out = stringifyJsonLd({ name: 'Test</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('\\u003c/script\\u003e');
  });

  it('escapes < > and & on regular fields', () => {
    const out = stringifyJsonLd({ name: 'a<b>c&d' });
    expect(out).toBe('{"name":"a\\u003cb\\u003ec\\u0026d"}');
  });

  it('escapes U+2028 and U+2029 line terminators', () => {
    // Use \u escapes in the source so the file stays ASCII; the literals would
    // otherwise be valid line terminators inside a string in some parsers.
    const out = stringifyJsonLd({ name: 'a b c' });
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    // Raw line-separator chars must not survive in the serialised output.
    expect(out).not.toContain(' ');
    expect(out).not.toContain(' ');
  });

  it('preserves valid JSON shape', () => {
    const out = stringifyJsonLd({ '@context': 'https://schema.org', name: 'Test' });
    // After unescaping the unicode sequences, parseable JSON.
    expect(JSON.parse(out)).toEqual({ '@context': 'https://schema.org', name: 'Test' });
  });
});
