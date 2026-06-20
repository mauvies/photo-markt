import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

/**
 * The health endpoint is a pure liveness probe — no auth, no DB. These tests
 * pin the contract external monitors rely on: 200 + `{ status: "ok" }` and a
 * non-cacheable response.
 */
describe('GET /api/health', () => {
  it('returns 200 with { status: "ok" }', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('is not cacheable', () => {
    const res = GET();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
