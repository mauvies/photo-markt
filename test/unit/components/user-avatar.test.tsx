/** @vitest-environment happy-dom */
import type { User } from '@supabase/supabase-js';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/database/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

vi.mock('@/lib/i18n/translations-provider', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}));

import { UserAvatar } from '@/components/user-avatar';

afterEach(cleanup);

const user = {
  email: 'talent@example.com',
  user_metadata: { avatar_url: 'https://example.com/a.png', full_name: 'Talent' },
} as unknown as User;

describe('UserAvatar', () => {
  it('rings the header avatar with the same thin border token as the toggler (T-003)', () => {
    const { container } = render(<UserAvatar user={user} />);
    const avatar = container.querySelector('[data-slot="avatar"]');
    expect(avatar?.className).toContain('border');
    expect(avatar?.className).toContain('border-input');
  });
});
