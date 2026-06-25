import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/health/probes', () => ({
  getCachedReadinessReport: vi.fn(async () => ({ status: 'ok', environment: 'test', checks: [] })),
}));

const rateLimitMock = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => rateLimitMock(),
  getClientIp: () => '203.0.113.9',
  retryAfterSeconds: () => 60,
}));

import { GET } from '@/app/api/health/ready/route';

// Matches test/setup.ts HEALTH_CHECK_TOKEN.
const TOKEN = 'health-token-fake-for-tests';
const req = (init?: { token?: string; header?: 'bearer' | 'x' | 'query' }) => {
  const headers = new Headers();
  let url = 'http://localhost/api/health/ready';
  if (init?.token) {
    if (init.header === 'bearer') headers.set('authorization', `Bearer ${init.token}`);
    else if (init.header === 'query') url += `?token=${init.token}`;
    else headers.set('x-health-token', init.token);
  }
  return new Request(url, { headers });
};

describe('GET /api/health/ready (T-044)', () => {
  beforeEach(() => {
    rateLimitMock.mockReset();
    rateLimitMock.mockResolvedValue({ ok: true });
  });

  it('401s without a token', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('401s with a wrong token', async () => {
    expect((await GET(req({ token: 'nope' }))).status).toBe(401);
  });

  it('returns the readiness report with the correct token (x-health-token header)', async () => {
    const res = await GET(req({ token: TOKEN }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ status: 'ok', environment: 'test' });
  });

  it('accepts the token via Bearer and via query', async () => {
    expect((await GET(req({ token: TOKEN, header: 'bearer' }))).status).toBe(200);
    expect((await GET(req({ token: TOKEN, header: 'query' }))).status).toBe(200);
  });

  it('429s when rate-limited (with Retry-After)', async () => {
    rateLimitMock.mockResolvedValue({ ok: false });
    const res = await GET(req({ token: TOKEN }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });
});
