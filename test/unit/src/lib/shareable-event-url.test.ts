import { describe, expect, it } from 'vitest';
import { getShareableEventPath, type ShareableEvent } from '@/lib/shareable-event-url';

const base: ShareableEvent = {
  id: 'evt-uuid',
  is_public: true,
  slug: 'summer-marathon',
  share_code: 'ABC123',
};

describe('getShareableEventPath', () => {
  it('uses the slug for a public event, prefixed with the locale', () => {
    expect(getShareableEventPath(base, 'es')).toBe('/es/events/summer-marathon');
    expect(getShareableEventPath(base, 'en')).toBe('/en/events/summer-marathon');
  });

  it('falls back to the id for a public event with no slug', () => {
    expect(getShareableEventPath({ ...base, slug: null }, 'es')).toBe('/es/events/evt-uuid');
  });

  it('uses the share code (NOT the slug/id) for a private event', () => {
    const privateEvent: ShareableEvent = { ...base, is_public: false };
    // A private event only resolves via its share code — a slug/id link would
    // silently fail to grant access.
    expect(getShareableEventPath(privateEvent, 'es')).toBe('/es/events/ABC123');
    expect(getShareableEventPath(privateEvent, 'es')).not.toContain('summer-marathon');
    expect(getShareableEventPath(privateEvent, 'es')).not.toContain('evt-uuid');
  });

  it('always carries the locale prefix', () => {
    expect(getShareableEventPath(base, 'en').startsWith('/en/')).toBe(true);
    expect(getShareableEventPath({ ...base, is_public: false }, 'en').startsWith('/en/')).toBe(
      true,
    );
  });
});
