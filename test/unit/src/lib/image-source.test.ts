import { describe, expect, it } from 'vitest';
import { shouldSkipImageOptimization } from '@/lib/image-source';

describe('shouldSkipImageOptimization', () => {
  it('skips optimization for baked /api/thumb thumbnails', () => {
    expect(shouldSkipImageOptimization('/api/thumb/uid/eventId/thumbs/abc/small.webp')).toBe(true);
  });

  it('skips optimization for versioned /api/thumb urls', () => {
    expect(shouldSkipImageOptimization('/api/thumb/uid/eventId/thumbs/abc/medium.webp?v=3')).toBe(
      true,
    );
  });

  it('skips optimization for /api/watermark previews', () => {
    expect(shouldSkipImageOptimization('/api/watermark/uid/eventId/photo.jpg')).toBe(true);
  });

  it('skips optimization for localhost sources (local Supabase in dev)', () => {
    expect(
      shouldSkipImageOptimization('http://localhost:54321/storage/v1/object/sign/photos/x.jpg'),
    ).toBe(true);
  });

  it('keeps optimization for signed Supabase covers', () => {
    expect(
      shouldSkipImageOptimization(
        'https://proj.supabase.co/storage/v1/object/sign/photos/cover.jpg?token=abc',
      ),
    ).toBe(false);
  });

  it('keeps optimization for avatar/profile images', () => {
    expect(shouldSkipImageOptimization('https://lh3.googleusercontent.com/a/avatar')).toBe(false);
  });
});
