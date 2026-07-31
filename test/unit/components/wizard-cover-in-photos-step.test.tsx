/** @vitest-environment happy-dom */

/**
 * Regression tests for T-210: the event cover image was configured on step 3
 * (Details), where T-105 had put it in a fixed ~20rem left column. It belongs
 * on step 4 (Photos) — both controls there are "pick images" — with the upload
 * area getting clearly more room than the one optional cover.
 *
 * The trap this pins: `Step4Photos` early-returned for `organizer` events
 * ("you don't upload your own photos"). Moving the cover there naively would
 * leave organizer events — which are public and render on cards — with no way
 * to set a cover at all.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Step4Photos } from '@/app/[lang]/dashboard/photographer/events/new/steps/step-4-photos';
import { Step5Review } from '@/app/[lang]/dashboard/photographer/events/new/steps/step-5-review';
import type { EventType } from '@/app/[lang]/dashboard/photographer/events/new/wizard.schema';
import enDict from '@/dictionaries/en.json';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // biome-ignore lint/performance/noImgElement: plain <img> stub for next/image in tests
    return <img src={src} alt={alt} />;
  },
}));

afterEach(cleanup);

const t = enDict.newEvent;

function renderStep4(
  eventType: EventType,
  overrides: { coverPreviewUrl?: string | null; onCoverChange?: (file: File | null) => void } = {},
) {
  const onCoverChange = overrides.onCoverChange ?? vi.fn();
  const result = render(
    <TranslationsProvider translations={enDict.newEvent}>
      <Step4Photos
        previews={[]}
        error={null}
        photosLost={false}
        eventType={eventType}
        coverPreviewUrl={overrides.coverPreviewUrl ?? null}
        onCoverChange={onCoverChange}
        onFiles={vi.fn()}
        onRemove={vi.fn()}
      />
    </TranslationsProvider>,
  );
  return { ...result, onCoverChange };
}

describe('the cover image is configured on the photos step (T-210)', () => {
  it.each<EventType>([
    'solo',
    'collaborative',
    'organizer',
  ])('renders the cover field for a %s event', (eventType) => {
    renderStep4(eventType);
    expect(screen.getByText(t.coverLabel)).toBeTruthy();
    expect(screen.getByText(t.coverSelect)).toBeTruthy();
  });

  it('still tells organizer events they upload no photos of their own', () => {
    renderStep4('organizer');
    // The notice survives — it just no longer early-returns past the cover.
    expect(screen.getByText(t.organizerNoOwnPhotosTitle)).toBeTruthy();
    expect(screen.queryByText(t.addPhotosLabel)).toBeNull();
  });

  it('keeps the dropzone for the event types that do upload', () => {
    renderStep4('solo');
    expect(screen.getByText(t.addPhotosLabel)).toBeTruthy();
    expect(screen.queryByText(t.organizerNoOwnPhotosTitle)).toBeNull();
  });

  it('reports a picked cover through onCoverChange, organizer included', () => {
    const { onCoverChange } = renderStep4('organizer');
    const input = document.getElementById('cover-image') as HTMLInputElement;
    const file = new File(['bytes'], 'cover.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onCoverChange).toHaveBeenCalledWith(file);
  });

  it('gives the photos more room than the cover on desktop', () => {
    const { container } = renderStep4('solo');
    // A narrow fixed column for the cover, the rest for the upload area.
    const row = container.querySelector(
      '.md\\:grid-cols-\\[minmax\\(0\\,16rem\\)_minmax\\(0\\,1fr\\)\\]',
    );
    expect(row).not.toBeNull();
  });
});

describe('the details step no longer owns the cover (T-210)', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      'src/app/[lang]/dashboard/photographer/events/new/steps/step-3-details.tsx',
    ),
    'utf8',
  );

  it('does not import or render the cover field', () => {
    expect(source).not.toContain('EventCoverField');
    expect(source).not.toContain('onCoverChange');
  });

  it('drops the two-column grid that existed only to host the cover', () => {
    expect(source).not.toContain('md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]');
  });
});

describe('the review step shows the cover and edits it on step 4 (T-210)', () => {
  function renderReview(coverPreviewUrl: string | null, eventType: EventType = 'solo') {
    const goToStep = vi.fn();
    render(
      <TranslationsProvider translations={enDict.newEvent}>
        <Step5Review
          sections={[]}
          previews={[]}
          coverPreviewUrl={coverPreviewUrl}
          photosLost={false}
          eventType={eventType}
          goToStep={goToStep}
        />
      </TranslationsProvider>,
    );
    return goToStep;
  }

  it('previews the picked cover', () => {
    renderReview('blob:cover');
    const img = screen.getByAltText(t.reviewCoverLabel) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:cover');
  });

  it('says the first photo is used when no cover was picked', () => {
    renderReview(null);
    expect(screen.getByText(t.reviewNoCover)).toBeTruthy();
  });

  it('sends Edit to the photos step, organizer events included', () => {
    const goToStep = renderReview(null, 'organizer');
    fireEvent.click(screen.getByRole('button', { name: t.wizardEdit }));
    expect(goToStep).toHaveBeenCalledWith(4, { remember: 5 });
  });
});
