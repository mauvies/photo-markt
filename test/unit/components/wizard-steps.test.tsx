/** @vitest-environment happy-dom */

/**
 * Regression tests for T-105: the create-event wizard was split so the first
 * step (which mixed event-type selection with the config switches) became two
 * steps — Type then Config — yielding FOUR numbered steps in the indicator
 * (Type → Config → Details → Photos). The review step is not numbered.
 *
 * Before the change the indicator listed three steps (Configuration, Details,
 * Photos). These tests assert the new four-step composition.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NUMBERED_STEP_IDS,
  REVIEW_STEP,
  TOTAL_STEPS,
  WizardSteps,
} from '@/app/[lang]/dashboard/photographer/events/new/components/wizard-steps';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

// Distinct labels so we can assert each step renders and Review is absent.
const labels = {
  step1Title: 'TYPE',
  step2Title: 'CONFIG',
  step3Title: 'DETAILS',
  step4Title: 'PHOTOS',
  step5Title: 'REVIEW',
  wizardStepsAria: 'Event creation steps',
} as const;

function renderSteps() {
  return render(
    <TranslationsProvider translations={labels}>
      {/* current=1, reached=4 → every numbered step is reachable/tappable. */}
      <WizardSteps current={1} reached={4} onSelect={vi.fn()} />
    </TranslationsProvider>,
  );
}

afterEach(cleanup);

describe('WizardSteps (T-105: four numbered steps)', () => {
  it('exposes 4 numbered steps and a review step at 5', () => {
    expect(TOTAL_STEPS).toBe(4);
    expect(NUMBERED_STEP_IDS).toEqual([1, 2, 3, 4]);
    expect(REVIEW_STEP).toBe(5);
  });

  it('renders exactly four step buttons in order: Type → Config → Details → Photos', () => {
    renderSteps();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(screen.getByText('TYPE')).toBeTruthy();
    expect(screen.getByText('CONFIG')).toBeTruthy();
    expect(screen.getByText('DETAILS')).toBeTruthy();
    expect(screen.getByText('PHOTOS')).toBeTruthy();
  });

  it('does not render the review step in the indicator', () => {
    renderSteps();
    expect(screen.queryByText('REVIEW')).toBeNull();
  });
});
