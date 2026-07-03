import { describe, expect, it } from 'vitest';
import { toDisplayPhotos } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/photo-data';

describe('toDisplayPhotos', () => {
  it('resolves url from the signed-url map keyed by original_url', () => {
    const result = toDisplayPhotos(
      [
        { id: 'a', original_url: 'owner/evt/a.jpg' },
        { id: 'b', original_url: 'owner/evt/b.jpg' },
      ],
      {
        'owner/evt/a.jpg': 'https://signed/a',
        'owner/evt/b.jpg': 'https://signed/b',
      },
    );
    expect(result).toEqual([
      { id: 'a', url: 'https://signed/a', original_url: 'owner/evt/a.jpg' },
      { id: 'b', url: 'https://signed/b', original_url: 'owner/evt/b.jpg' },
    ]);
  });

  it('falls back to null url when the path has no signed url (genuine "no preview")', () => {
    const result = toDisplayPhotos([{ id: 'a', original_url: 'owner/evt/a.jpg' }], {});
    expect(result[0]?.url).toBeNull();
  });

  it('maps url to null when original_url is null', () => {
    const result = toDisplayPhotos([{ id: 'a', original_url: null }], {
      'owner/evt/a.jpg': 'https://signed/a',
    });
    expect(result[0]?.url).toBeNull();
  });
});
