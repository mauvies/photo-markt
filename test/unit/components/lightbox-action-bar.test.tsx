/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LightboxActionBar, type LightboxActionLabels } from '@/components/lightbox-action-bar';

afterEach(cleanup);

const labels: LightboxActionLabels = {
  download: 'Download',
  addToFavorites: 'Add to favorites',
  removeFromFavorites: 'Remove from favorites',
  addToProfile: 'Add to profile',
  addedToProfile: 'Added to profile',
  addToCart: 'Add to cart',
  removeFromCart: 'Remove from cart',
  uploadedBy: 'Uploaded by {name}',
};

describe('LightboxActionBar', () => {
  it('renders only the actions whose show* flag is set', () => {
    render(
      <LightboxActionBar
        visible
        labels={labels}
        showDownload
        onDownload={vi.fn()}
        showCart
        onCart={vi.fn()}
      />,
    );
    expect(screen.getByText('Download')).toBeTruthy();
    expect(screen.getByText('Add to cart')).toBeTruthy();
    // Favorites / profile were not enabled.
    expect(screen.queryByText('Add to favorites')).toBeNull();
    expect(screen.queryByText('Add to profile')).toBeNull();
  });

  it('omits an enabled action when its label is missing (à la carte labels)', () => {
    render(<LightboxActionBar visible labels={{}} showDownload onDownload={vi.fn()} />);
    expect(screen.queryByText('Download')).toBeNull();
  });

  it('fires the handler when an action is clicked', () => {
    const onDownload = vi.fn();
    render(<LightboxActionBar visible labels={labels} showDownload onDownload={onDownload} />);
    fireEvent.click(screen.getByText('Download'));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('reflects the favorited state and disables claim once claimed', () => {
    render(
      <LightboxActionBar
        visible
        labels={labels}
        showFavorite
        isFavorited
        onFavorite={vi.fn()}
        showClaim
        isClaimed
        onClaim={vi.fn()}
      />,
    );
    expect(screen.getByText('Remove from favorites')).toBeTruthy();
    const claimButton = screen.getByText('Added to profile').closest('button');
    expect(claimButton?.disabled).toBe(true);
  });

  it('renders the "Uploaded by" caption with the name substituted', () => {
    render(
      <LightboxActionBar
        visible
        labels={labels}
        uploaderName="María G."
        showDownload
        onDownload={vi.fn()}
      />,
    );
    expect(screen.getByText('Uploaded by María G.')).toBeTruthy();
  });
});
