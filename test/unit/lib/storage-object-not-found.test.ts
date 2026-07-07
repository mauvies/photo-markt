import { describe, expect, it } from 'vitest';
import { isStorageObjectNotFound } from '@/lib/storage-object-not-found';

describe('isStorageObjectNotFound', () => {
  // Verified shape from the local Supabase Storage emulator when downloading a
  // missing object: { name: "StorageApiError", message: "Object not found",
  // status: 400, statusCode: "404" }. `status` is the wrapping HTTP status
  // (400, not 404!) — statusCode carries the real semantic code.
  it('recognizes the real Supabase Storage "not found" shape', () => {
    expect(isStorageObjectNotFound({ message: 'Object not found', statusCode: '404' })).toBe(true);
  });

  it('recognizes by statusCode alone', () => {
    expect(isStorageObjectNotFound({ statusCode: '404' })).toBe(true);
  });

  it('recognizes by message text alone (case-insensitive)', () => {
    expect(isStorageObjectNotFound({ message: 'OBJECT NOT FOUND' })).toBe(true);
  });

  it('returns false for a transient/other error', () => {
    expect(isStorageObjectNotFound({ message: 'Network timeout', statusCode: '500' })).toBe(false);
  });

  it('statusCode "404" takes precedence even with an unrelated message', () => {
    expect(isStorageObjectNotFound({ message: 'Bucket not found', statusCode: '404' })).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(isStorageObjectNotFound(null)).toBe(false);
    expect(isStorageObjectNotFound(undefined)).toBe(false);
  });

  it('returns false for an empty error object', () => {
    expect(isStorageObjectNotFound({})).toBe(false);
  });
});
