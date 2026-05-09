import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringifyJsonLd } from '../../lib/json-ld';

test('stringifyJsonLd escapes </script> so it cannot break out of an inline <script> block', () => {
  const out = stringifyJsonLd({ name: 'Test</script><script>alert(1)</script>' });
  assert.ok(!out.includes('</script>'), 'literal </script> must not appear in output');
  assert.ok(!out.includes('<script>'), 'literal <script> must not appear in output');
  assert.ok(out.includes('\\u003c/script\\u003e'), 'closing script tag must be unicode-escaped');
});

test('stringifyJsonLd escapes < > and & on regular fields', () => {
  const out = stringifyJsonLd({ name: 'a<b>c&d' });
  assert.equal(out, '{"name":"a\\u003cb\\u003ec\\u0026d"}');
});

test('stringifyJsonLd escapes U+2028 and U+2029 line terminators', () => {
  // Use \u escapes in the source so the file stays ASCII; the literals would
  // otherwise be valid line terminators inside a string in some parsers.
  const out = stringifyJsonLd({ name: 'a b c' });
  assert.ok(out.includes('\\u2028'));
  assert.ok(out.includes('\\u2029'));
  // Raw line-separator chars must not survive in the serialised output.
  assert.ok(!out.includes(' '));
  assert.ok(!out.includes(' '));
});

test('stringifyJsonLd preserves valid JSON shape', () => {
  const out = stringifyJsonLd({ '@context': 'https://schema.org', name: 'Test' });
  // After unescaping the unicode sequences, parseable JSON.
  assert.deepEqual(JSON.parse(out), { '@context': 'https://schema.org', name: 'Test' });
});
