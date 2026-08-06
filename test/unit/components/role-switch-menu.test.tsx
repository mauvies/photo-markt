/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { switchRoleMock, enablePhotographerMock, enableTalentMock, pushMock, toastError } =
  vi.hoisted(() => ({
    switchRoleMock: vi.fn(),
    enablePhotographerMock: vi.fn(),
    enableTalentMock: vi.fn(),
    pushMock: vi.fn(),
    toastError: vi.fn(),
  }));

vi.mock('@/app/[lang]/actions/roles', () => ({
  switchRole: switchRoleMock,
  enablePhotographerRole: enablePhotographerMock,
  enableTalentRole: enableTalentMock,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => '/en/dashboard/talent/events',
  useParams: () => ({ lang: 'en' }),
}));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock('@/database/client', () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));

import { DashboardUserMenu } from '@/components/dashboard-user-menu';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * T-234. The report: a talent-only user tapped "Switch to Photographer" and
 * NOTHING happened. Two defects met there — the menu offered a switch the
 * server could only refuse (that account has never held PHOTOGRAPHER), and both
 * switchers swallowed the refusal in a bare `catch {}`, so the UI looked
 * untouched. These tests pin both halves.
 */
const navLabels = {
  activeRole: 'Role',
  profile: 'Profile',
  settings: 'Settings',
  support: 'Support',
  feedback: 'Feedback',
  switchTo: 'Switch to',
  becomePhotographer: 'Become a photographer',
  becomeTalent: 'Become a talent',
  roleActionFailed: "We couldn't change your role. Please try again.",
  roleActionNotSignedIn: 'Please sign in again to change your role.',
  logOut: 'Log out',
  rolePhotographer: 'Photographer',
  roleTalent: 'Talent',
};

const user = { name: 'Tom', email: 'tom@example.com', avatar: null };

/** Radix opens on `pointerdown`, not `click` — same helper shape as
 *  `language-switcher.test.tsx`. */
function openMenu() {
  const trigger = screen.getByRole('button', { name: 'User menu' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe('DashboardUserMenu — role switching (T-234)', () => {
  it('offers "Become a photographer" to a talent-only user, not a switch that must fail', async () => {
    render(
      <DashboardUserMenu
        user={user}
        activeRole="talent"
        heldRoles={['talent']}
        navLabels={navLabels}
      />,
    );
    openMenu();

    expect(await screen.findByText('Become a photographer')).toBeTruthy();
    expect(screen.queryByText('Switch to Photographer')).toBeNull();
  });

  it('grants the role through the enable action, not switchRole', async () => {
    enablePhotographerMock.mockResolvedValueOnce({ ok: true, activeRole: 'photographer' });
    render(
      <DashboardUserMenu
        user={user}
        activeRole="talent"
        heldRoles={['talent']}
        navLabels={navLabels}
      />,
    );
    openMenu();
    fireEvent.click(await screen.findByText('Become a photographer'));

    await waitFor(() => expect(enablePhotographerMock).toHaveBeenCalled());
    // `switchRole` refuses a role you don't hold, by design — routing the
    // "become" intent through it is what produced the original bug report.
    expect(switchRoleMock).not.toHaveBeenCalled();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/dashboard/photographer'));
  });

  it('still offers a plain switch to a user who holds both roles', async () => {
    switchRoleMock.mockResolvedValueOnce({ ok: true, activeRole: 'photographer' });
    render(
      <DashboardUserMenu
        user={user}
        activeRole="talent"
        heldRoles={['talent', 'photographer']}
        navLabels={navLabels}
      />,
    );
    openMenu();
    fireEvent.click(await screen.findByText('Switch to Photographer'));

    await waitFor(() => expect(switchRoleMock).toHaveBeenCalledWith('photographer'));
    expect(enablePhotographerMock).not.toHaveBeenCalled();
  });

  it('tells the user when the action is refused instead of failing silently', async () => {
    // THE regression: before T-234 this path was `catch { revert }` with no
    // toast, which is exactly what "no sucede nada" described.
    switchRoleMock.mockResolvedValueOnce({ ok: false, error: 'role_not_held' });
    render(
      <DashboardUserMenu
        user={user}
        activeRole="talent"
        heldRoles={['talent', 'photographer']}
        navLabels={navLabels}
      />,
    );
    openMenu();
    fireEvent.click(await screen.findByText('Switch to Photographer'));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("We couldn't change your role. Please try again."),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('uses the distinct copy for a lost session', async () => {
    switchRoleMock.mockResolvedValueOnce({ ok: false, error: 'not_signed_in' });
    render(
      <DashboardUserMenu
        user={user}
        activeRole="talent"
        heldRoles={['talent', 'photographer']}
        navLabels={navLabels}
      />,
    );
    openMenu();
    fireEvent.click(await screen.findByText('Switch to Photographer'));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Please sign in again to change your role.'),
    );
  });

  it('reports a thrown action as a failure rather than leaving the menu mute', async () => {
    switchRoleMock.mockRejectedValueOnce(new Error('network'));
    render(
      <DashboardUserMenu
        user={user}
        activeRole="talent"
        heldRoles={['talent', 'photographer']}
        navLabels={navLabels}
      />,
    );
    openMenu();
    fireEvent.click(await screen.findByText('Switch to Photographer'));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("We couldn't change your role. Please try again."),
    );
  });
});
