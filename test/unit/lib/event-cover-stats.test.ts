import { describe, expect, it } from 'vitest';
import { resolvePublicEventCoverStats } from '@/lib/event-cover-stats';

// Regression: T-072 — a public event with photos uploaded but not yet indexed
// (all `pending`) was invisible on public surfaces (excluded from "Featured",
// empty cover in search results) because the old cover query was approved-only
// for every event, regardless of whether the event even has an indexing
// pipeline to wait on.
describe('resolvePublicEventCoverStats', () => {
  it('counts pending photos for an event WITHOUT AI matching configured', () => {
    const stats = resolvePublicEventCoverStats(
      [
        {
          event_id: 'e1',
          original_url: 'p1.jpg',
          thumbnail_status: 'ready',
          thumb_version: 3,
          upload_status: 'pending',
        },
        {
          event_id: 'e1',
          original_url: 'p2.jpg',
          thumbnail_status: null,
          upload_status: 'pending',
        },
      ],
      new Set(), // no AI-enabled events
    );
    // T-078: the cover row's thumb_version is captured for CDN cache-busting.
    expect(stats.get('e1')).toEqual({
      count: 2,
      coverPath: 'p1.jpg',
      coverThumbReady: true,
      coverThumbVersion: 3,
    });
  });

  it('excludes pending photos for an event WITH AI matching configured', () => {
    const stats = resolvePublicEventCoverStats(
      [
        {
          event_id: 'e1',
          original_url: 'p1.jpg',
          thumbnail_status: 'ready',
          upload_status: 'pending',
        },
        {
          event_id: 'e1',
          original_url: 'p2.jpg',
          thumbnail_status: 'ready',
          upload_status: 'approved',
        },
      ],
      new Set(['e1']),
    );
    // Only the approved row counts/covers — the pending row is invisible until
    // indexing promotes it (that promotion IS the moderation gate here).
    expect(stats.get('e1')).toEqual({
      count: 1,
      coverPath: 'p2.jpg',
      coverThumbReady: true,
      coverThumbVersion: null,
    });
  });

  it('an AI-enabled event with ONLY pending photos yields no stat at all', () => {
    const stats = resolvePublicEventCoverStats(
      [
        {
          event_id: 'e1',
          original_url: 'p1.jpg',
          thumbnail_status: 'ready',
          upload_status: 'pending',
        },
      ],
      new Set(['e1']),
    );
    expect(stats.has('e1')).toBe(false);
  });

  it('applies the AI gate independently per event', () => {
    const stats = resolvePublicEventCoverStats(
      [
        {
          event_id: 'ai-event',
          original_url: 'a.jpg',
          thumbnail_status: null,
          upload_status: 'pending',
        },
        {
          event_id: 'non-ai-event',
          original_url: 'b.jpg',
          thumbnail_status: null,
          upload_status: 'pending',
        },
      ],
      new Set(['ai-event']),
    );
    expect(stats.has('ai-event')).toBe(false);
    expect(stats.get('non-ai-event')).toEqual({
      count: 1,
      coverPath: 'b.jpg',
      coverThumbReady: false,
      coverThumbVersion: null,
    });
  });

  it('keeps the first row (by input order) as the cover, skipping later rows', () => {
    const stats = resolvePublicEventCoverStats(
      [
        {
          event_id: 'e1',
          original_url: 'first.jpg',
          thumbnail_status: null,
          upload_status: 'approved',
        },
        {
          event_id: 'e1',
          original_url: 'second.jpg',
          thumbnail_status: null,
          upload_status: 'approved',
        },
      ],
      new Set(),
    );
    expect(stats.get('e1')?.coverPath).toBe('first.jpg');
    expect(stats.get('e1')?.count).toBe(2);
  });

  it('skips rows with no event_id', () => {
    const stats = resolvePublicEventCoverStats(
      [
        {
          event_id: null,
          original_url: 'orphan.jpg',
          thumbnail_status: null,
          upload_status: 'approved',
        },
      ],
      new Set(),
    );
    expect(stats.size).toBe(0);
  });

  it('returns an empty map for an empty row list', () => {
    expect(resolvePublicEventCoverStats([], new Set()).size).toBe(0);
  });
});
