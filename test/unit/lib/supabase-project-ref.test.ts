import { describe, expect, it } from 'vitest';
import { getSupabaseProjectRef } from '@/lib/supabase-project-ref';

// T-231: a photo uploaded to one Supabase project and processed by a worker
// pointed at another fails with "Object not found" on an object that plainly
// exists. Naming the project the worker read is what separates that from a
// genuinely missing object, so this must never throw and never return ''.
describe('getSupabaseProjectRef', () => {
  it('extracts the ref from a hosted project URL', () => {
    expect(getSupabaseProjectRef('https://abcdefghijklmnop.supabase.co')).toBe('abcdefghijklmnop');
    expect(getSupabaseProjectRef('https://abcdefghijklmnop.supabase.co/rest/v1')).toBe(
      'abcdefghijklmnop',
    );
  });

  it('keeps the host for a local stack — "local" vs "some hosted project" is the point', () => {
    expect(getSupabaseProjectRef('http://127.0.0.1:54321')).toBe('127.0.0.1');
  });

  it('never throws on missing or malformed input', () => {
    expect(getSupabaseProjectRef(null)).toBe('unknown');
    expect(getSupabaseProjectRef(undefined)).toBe('unknown');
    expect(getSupabaseProjectRef('')).toBe('unknown');
    expect(getSupabaseProjectRef('not a url')).toBe('unknown');
  });
});
