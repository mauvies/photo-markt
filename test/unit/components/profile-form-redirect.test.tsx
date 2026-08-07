/**
 * @vitest-environment happy-dom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * T-241. Saving the photographer profile flashed an error banner reading
 * `NEXT_REDIRECT` and then saved fine.
 *
 * There was no error. `updateProfileAction` ends in `localizedRedirect(...)`, and
 * Next implements `redirect()` by THROWING a control-flow exception; the form's
 * generic catch treated that as a failed save and rendered `error.message`. So
 * the user was shown the internals of a correct save with the word "error" in
 * front of them.
 *
 * The two tests below are the whole contract: control-flow exceptions must be
 * re-thrown untouched, real errors must still reach the banner.
 */

const { rethrowMock } = vi.hoisted(() => ({ rethrowMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  // The real `unstable_rethrow` re-throws Next's control-flow errors and returns
  // for anything else. Modelled here so the test does not depend on Next's
  // internal digest format.
  unstable_rethrow: (err: unknown) => rethrowMock(err),
}));

import { ProfileForm } from '@/components/profile-form';
import esDict from '@/dictionaries/es.json';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

function renderForm(onSubmit: (values: unknown) => Promise<void>) {
  return render(
    <TranslationsProvider translations={esDict.profileForm}>
      <ProfileForm
        initialValues={{ username: 'someone', display_name: 'Someone', bio: '' }}
        onSubmit={onSubmit as never}
      />
    </TranslationsProvider>,
  );
}

describe('ProfileForm submit error handling (T-241)', () => {
  it('does NOT show a banner when the action redirects', async () => {
    rethrowMock.mockImplementation((err: unknown) => {
      // Stand-in for Next's real behaviour on a NEXT_REDIRECT.
      if ((err as Error)?.message === 'NEXT_REDIRECT') throw err;
    });
    const redirecting = vi.fn(async () => {
      throw new Error('NEXT_REDIRECT');
    });

    renderForm(redirecting);
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(esDict.profileForm.saveChanges, 'i') }),
    );

    await waitFor(() => expect(redirecting).toHaveBeenCalled());
    // The literal the user was being shown must never reach the DOM.
    expect(screen.queryByText(/NEXT_REDIRECT/)).toBeNull();
  });

  it('still shows a banner for a real failure', async () => {
    rethrowMock.mockImplementation(() => undefined);
    const failing = vi.fn(async () => {
      throw new Error('Username is already taken');
    });

    renderForm(failing);
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(esDict.profileForm.saveChanges, 'i') }),
    );

    await waitFor(() => expect(screen.queryByText('Username is already taken')).not.toBeNull());
  });
});
