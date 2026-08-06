/** @vitest-environment happy-dom */

/**
 * Regression tests for T-206: the `/edit` page was one flat column.
 *
 * Cover → (fields | dropzone) → AI settings → photo grid, stacked with no
 * headings, so nothing told the photographer which group a control belonged to.
 * Worse, the cover persists the moment it is picked (T-166) while everything
 * else waits for Save, and the page said nothing about that split.
 *
 * Two other defects on the same screen:
 *  - the Save/Cancel bar was `fixed bottom-0 inset-x-0 z-50`, i.e. underneath
 *    the photographer bottom-nav on mobile (also `bottom-0`, also `z-50`) and
 *    blind to `env(safe-area-inset-bottom)`;
 *  - its labels ("Save Changes", "Saving...", "Cancel") were hardcoded English.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditEventForm } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-form';
import type { Event } from '@/database/queries/events';
import esDict from '@/dictionaries/es.json';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // biome-ignore lint/performance/noImgElement: plain <img> stub for next/image in tests
    return <img src={src} alt={alt} />;
  },
}));

vi.mock('@/hooks/use-localized-path', () => ({
  useLocalizedPath: () => (path: string) => path,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock('@/app/[lang]/dashboard/photographer/events/new/actions', () => ({
  createEventCoverUploadUrlAction: vi.fn(),
  attachEventCoverAction: vi.fn(),
  removeEventCoverAction: vi.fn(),
}));

vi.mock('@/lib/upload-event-cover', () => ({
  uploadEventCover: vi.fn(),
  MAX_COVER_BYTES: 50 * 1024 * 1024,
  CoverUploadError: class extends Error {},
}));

vi.mock('@/app/[lang]/dashboard/photographer/events/[id]/edit/actions', () => ({
  updateEventAction: vi.fn(),
}));

vi.mock('@/lib/use-photo-upload', () => ({
  usePhotoUpload: () => ({
    run: vi.fn(),
    cancel: vi.fn(),
    retryFailed: vi.fn(),
    reset: vi.fn(),
    isActive: false,
    stage: 'idle',
    progressBytes: 0,
    totalBytes: 0,
    completedCount: 0,
    totalCount: 0,
    failedCount: 0,
    errorMessage: null,
  }),
}));

afterEach(cleanup);

const details = esDict.eventDetails;

const event = {
  id: 'event-1',
  user_id: 'photographer-1',
  name: 'Evento',
  activity: 'SURF',
  date: '2026-06-15',
  city: 'Barcelona',
  state: 'Catalunya',
  country: 'ES',
  is_public: true,
  watermark_enabled: true,
  is_collaborative: false,
  allow_guest_upload: true,
  require_upload_approval: false,
  price_per_photo: 5,
  session_time: null,
  share_code: null,
  slug: 'evento',
  type: 'solo',
} as unknown as Event;

function renderForm() {
  return render(
    <TranslationsProvider translations={esDict.newEvent}>
      <EditEventForm
        event={event}
        initialPhotos={[]}
        initialCoverUrl={null}
        bundleT={esDict.bundlePricing}
        detailsT={details}
      />
    </TranslationsProvider>,
  );
}

describe('the edit page is grouped into sections (T-206)', () => {
  it('renders a titled card per section instead of one flat column', () => {
    renderForm();

    for (const title of [details.infoTitle, details.settingsTitle, details.editPhotosTitle]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    for (const subtitle of [
      details.editInfoSubtitle,
      details.editSettingsSubtitle,
      details.editPhotosSubtitle,
    ]) {
      expect(screen.getByText(subtitle)).toBeTruthy();
    }
  });

  it('says which control saves on the spot and which wait for Save', () => {
    // The cover is the only immediate-save control on the page; before T-206
    // nothing distinguished it from the fields that need Save.
    renderForm();

    expect(screen.getByText(details.editSavedInstantlyBadge)).toBeTruthy();
    expect(screen.getByText(details.editCoverSavedInstantly)).toBeTruthy();
    expect(screen.getByText(details.editUnsavedHint)).toBeTruthy();
  });
});

describe('the action bar is localized and clears the mobile nav (T-206)', () => {
  it('labels Save and Cancel from the dictionary', () => {
    renderForm();

    expect(screen.getByRole('button', { name: details.saveChanges })).toBeTruthy();
    expect(screen.getByRole('button', { name: details.cancel })).toBeTruthy();
    // The hardcoded English is gone.
    expect(screen.queryByText('Save Changes')).toBeNull();
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('sits above the mobile bottom nav and respects the safe-area inset', () => {
    const { container } = renderForm();

    const bar = container.querySelector('.fixed.z-50');
    expect(bar).not.toBeNull();
    const className = bar?.getAttribute('class') ?? '';
    // Same offsets as the create wizard's bar: above the 4rem mobile nav plus
    // the inset, and aligned to the sidebar from md up.
    expect(className).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom))]');
    expect(className).toContain('md:bottom-0');
    expect(className).toContain('md:left-(--sidebar-width)');
  });

  it('reserves enough bottom padding that the bar cannot cover the last card', () => {
    const { container } = renderForm();

    const form = container.querySelector('form');
    expect(form?.getAttribute('class') ?? '').toContain(
      'pb-[calc(9rem+env(safe-area-inset-bottom))]',
    );
  });
});
