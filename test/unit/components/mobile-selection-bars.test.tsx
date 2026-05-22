/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileSelectionBars } from '@/components/photo-gallery/mobile-selection-bars';

afterEach(cleanup);

describe('MobileSelectionBars', () => {
  it('shows the selected-count label in the top bar', () => {
    render(
      <MobileSelectionBars countLabel="3 selected" exitLabel="Exit selection" onExit={vi.fn()}>
        <button type="button">Download</button>
      </MobileSelectionBars>,
    );
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('renders the bulk-action children in the bottom bar', () => {
    render(
      <MobileSelectionBars countLabel="1 selected" exitLabel="Exit selection" onExit={vi.fn()}>
        <button type="button">Add to cart</button>
      </MobileSelectionBars>,
    );
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeTruthy();
  });

  it('calls onExit when the X button is pressed', () => {
    const onExit = vi.fn();
    render(
      <MobileSelectionBars countLabel="2 selected" exitLabel="Exit selection" onExit={onExit}>
        <span />
      </MobileSelectionBars>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Exit selection' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
