/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/dashboard/talent/profile',
  useParams: () => ({ lang: 'es' }),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock('@/app/[lang]/actions/roles', () => ({
  switchRole: vi.fn(async () => ({ activeRole: 'photographer' })),
}));

vi.mock('@/database/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { BottomNavAccount } from '@/components/bottom-nav-account';

afterEach(cleanup);

const user = { name: 'Ana', email: 'ana@example.com', avatar: null };

// The role-switch handler reads useQueryClient (to bust the active-role cache
// on switch); wrap renders in a provider so the hook resolves.
function renderAccount(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const baseLabels = {
  accountTab: 'Account',
  activeRoleLabel: 'Role',
  currentRoleName: 'Talent',
  switchRoleLabel: 'Switch to Photographer',
  profile: 'Profile',
  settings: 'Settings',
  support: 'Support',
  feedback: 'Feedback',
  logOut: 'Log out',
};

function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Account menu' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
  fireEvent.click(trigger);
}

// T-118: mirrors DashboardUserMenu's Orders item — the mobile bottom-nav
// account dropdown gains the same entry point (Orders is no longer a
// bottom-nav tab of its own).
describe('BottomNavAccount Orders item (T-118)', () => {
  it('shows an Orders item for talent with the orders label set', () => {
    renderAccount(
      <BottomNavAccount
        user={user}
        activeRole="talent"
        labels={{ ...baseLabels, orders: 'Orders' }}
      />,
    );

    openMenu();

    expect(screen.getByRole('menuitem', { name: /Orders/ })).toBeTruthy();
  });

  it('hides the Orders item for a photographer', () => {
    renderAccount(
      <BottomNavAccount
        user={user}
        activeRole="photographer"
        labels={{ ...baseLabels, orders: 'Orders' }}
      />,
    );

    openMenu();

    expect(screen.queryByRole('menuitem', { name: /Orders/ })).toBeNull();
  });

  it('hides the Orders item when no label is provided', () => {
    renderAccount(<BottomNavAccount user={user} activeRole="talent" labels={baseLabels} />);

    openMenu();

    expect(screen.queryByRole('menuitem', { name: /Orders/ })).toBeNull();
  });
});
