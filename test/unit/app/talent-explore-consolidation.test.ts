import { describe, expect, it, vi } from 'vitest';

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import TalentExplorePage from '@/app/[lang]/dashboard/talent/events/page';
import TalentDashboardPage from '@/app/[lang]/dashboard/talent/page';

// T-118: `/` is the sole talent home/explore surface now — both the old
// dashboard root and the dedicated explore page forward there instead of
// rendering their own content.
describe('Talent route consolidation (T-118)', () => {
  it('/dashboard/talent redirects to the unified home', async () => {
    await expect(TalentDashboardPage({ params: Promise.resolve({ lang: 'es' }) })).rejects.toThrow(
      'NEXT_REDIRECT:/es',
    );
  });

  it('/dashboard/talent/events (no filters) redirects to the unified home', async () => {
    await expect(
      TalentExplorePage({
        params: Promise.resolve({ lang: 'es' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/es');
  });

  it('/dashboard/talent/events with filters forwards to /events, preserving the query string', async () => {
    await expect(
      TalentExplorePage({
        params: Promise.resolve({ lang: 'es' }),
        searchParams: Promise.resolve({ where: 'Madrid', activity: 'running' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/es/events?where=Madrid&activity=running');
  });
});
