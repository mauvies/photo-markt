/** @vitest-environment happy-dom */

/**
 * T-232 — cover editing existed (T-166) but was unreachable from the tabs a
 * photographer actually navigates by.
 *
 * `details` and `pricing` open the *scoped* editor, which leaves photos and
 * cover untouched by design; the full `/edit` form — the only surface showing
 * the cover — hung off an unlabelled "⋮" dropdown next to "Delete event". The
 * reporting photographer concluded the feature did not exist. The cost is real:
 * the cover is what decides how the event looks on cards and as `og:image`.
 *
 * Two things are pinned: the Photos tab actually renders the block (the
 * discoverability half of the bug), and the block persists through the
 * pre-existing actions, rolling the optimistic preview back when they fail.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadEventCover, removeEventCoverAction, toastError } = vi.hoisted(() => ({
  uploadEventCover: vi.fn(async () => undefined),
  removeEventCoverAction: vi.fn(async () => undefined),
  toastError: vi.fn(),
}));

vi.mock('@/lib/upload-event-cover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upload-event-cover')>();
  return { ...actual, uploadEventCover };
});
vi.mock('@/app/[lang]/dashboard/photographer/events/new/actions', () => ({
  removeEventCoverAction,
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

import { EventCoverSection } from '@/app/[lang]/dashboard/photographer/events/[id]/event-cover-section';
import enDict from '@/dictionaries/en.json';

const fieldLabels = {
  label: enDict.newEvent.coverLabel,
  desc: enDict.newEvent.coverDesc,
  infoAria: enDict.newEvent.coverInfoAria,
  select: enDict.newEvent.coverSelect,
  remove: enDict.newEvent.coverRemove,
};

const labels = {
  savedBadge: enDict.eventDetails.editSavedInstantlyBadge,
  savedHint: enDict.eventDetails.editCoverSavedInstantly,
  notForSaleNote: enDict.events.coverNotForSale,
  tooLarge: enDict.newEvent.coverTooLarge,
  updateFailed: enDict.newEvent.coverUpdateFailed,
};

function renderSection(initialCoverUrl: string | null) {
  return render(
    <EventCoverSection
      eventId="evt_1"
      initialCoverUrl={initialCoverUrl}
      fieldLabels={fieldLabels}
      labels={labels}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // happy-dom has no object-URL support.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

describe('EventCoverSection', () => {
  it('uploads through the existing cover action when a file is picked', async () => {
    renderSection(null);

    const input = document.getElementById('event-tab-cover-image') as HTMLInputElement;
    const file = new File(['bytes'], 'cover.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadEventCover).toHaveBeenCalledWith('evt_1', file));
    // No new action was invented: removal still goes through the T-166 one.
    expect(removeEventCoverAction).not.toHaveBeenCalled();
  });

  it('removes through the existing action from the filled state', async () => {
    renderSection('https://signed.example/cover.jpg');

    fireEvent.click(screen.getByText(enDict.newEvent.coverRemove));

    await waitFor(() => expect(removeEventCoverAction).toHaveBeenCalledWith('evt_1'));
  });

  it('rolls the optimistic preview back and toasts when the upload fails', async () => {
    uploadEventCover.mockRejectedValueOnce(new Error('storage refused'));
    renderSection('https://signed.example/old.jpg');

    // Replacing means picking a new file while a cover already exists.
    fireEvent.click(screen.getByText(enDict.newEvent.coverRemove));
    await waitFor(() => expect(removeEventCoverAction).toHaveBeenCalled());

    const input = document.getElementById('event-tab-cover-image') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['bytes'], 'cover.jpg', { type: 'image/jpeg' })] },
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(enDict.newEvent.coverUpdateFailed));
    // The failed pick did not stick.
    expect(screen.queryByAltText(enDict.newEvent.coverLabel)).toBeNull();
  });

  it('says the cover is not one of the photos being sold', () => {
    renderSection(null);
    expect(screen.getByText(enDict.events.coverNotForSale)).toBeTruthy();
  });
});

describe('the Photos tab', () => {
  // The discoverability half of the bug: the capability worked, but no tab led
  // to it. A source guard, because the tab is assembled in a Server Component
  // that fetches an event, signs URLs and reads the dictionary.
  const source = readFileSync(
    resolve(process.cwd(), 'src/app/[lang]/dashboard/photographer/events/[id]/page.tsx'),
    'utf8',
  );

  it('renders the cover block', () => {
    expect(source).toContain('<EventCoverSection');
  });

  it('puts it inside the photos tab, above the grid', () => {
    const photosTab = source.slice(
      source.indexOf('const photosTab = ('),
      source.indexOf('const detailsTab = ('),
    );
    expect(photosTab).toContain('<EventCoverSection');
    expect(photosTab.indexOf('<EventCoverSection')).toBeLessThan(
      photosTab.indexOf('<EventPhotoAlbum'),
    );
  });

  it('keeps the full /edit form as an entry point too', () => {
    const editForm = readFileSync(
      resolve(
        process.cwd(),
        'src/app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-form.tsx',
      ),
      'utf8',
    );
    expect(editForm).toContain('<EventCoverField');
  });
});
