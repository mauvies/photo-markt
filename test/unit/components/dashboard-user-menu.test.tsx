/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/dashboard/talent/profile',
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock('@/app/[lang]/actions/roles', () => ({
  switchRole: vi.fn(async () => ({ activeRole: 'photographer' })),
}));

vi.mock('@/database/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { DashboardUserMenu } from '@/components/dashboard-user-menu';

afterEach(cleanup);

const user = { name: 'Ana', email: 'ana@example.com', avatar: null };

// The role-switch handler reads useQueryClient (to bust the active-role cache
// on switch); wrap renders in a provider so the hook resolves.
function renderMenu(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// T-118: Orders no longer has its own nav link/tab — this dropdown is its
// only entry point (alongside the pre-existing Profile item).
describe('DashboardUserMenu Orders item (T-118)', () => {
  it('shows an Orders item for a talent with the orders label set', () => {
    renderMenu(
      <DashboardUserMenu
        user={user}
        activeRole="talent"
        navLabels={{ profile: 'Profile', orders: 'Orders', settings: 'Settings' }}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'User menu' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);

    expect(screen.getByRole('menuitem', { name: /Orders/ })).toBeTruthy();
  });

  it('hides the Orders item for a photographer', () => {
    renderMenu(
      <DashboardUserMenu
        user={user}
        activeRole="photographer"
        navLabels={{ profile: 'Profile', orders: 'Orders', settings: 'Settings' }}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'User menu' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);

    expect(screen.queryByRole('menuitem', { name: /Orders/ })).toBeNull();
  });

  it('hides the Orders item when no label is provided', () => {
    renderMenu(<DashboardUserMenu user={user} activeRole="talent" navLabels={{}} />);

    const trigger = screen.getByRole('button', { name: 'User menu' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);

    expect(screen.queryByRole('menuitem', { name: /Orders/ })).toBeNull();
  });
});
