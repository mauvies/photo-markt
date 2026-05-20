import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

/**
 * Regression test for the AI face-search camera bug.
 *
 * The `Permissions-Policy` response header gates `navigator.mediaDevices`.
 * An empty camera allowlist (`camera=()`) disables the camera for EVERY
 * origin — including our own — so `getUserMedia` throws `NotAllowedError`
 * without ever showing the browser permission prompt. The selfie capture
 * needs `camera=(self)` so same-origin camera access works while
 * cross-origin iframes stay blocked.
 */
describe('next.config Permissions-Policy header', () => {
  it('allows the camera for the site origin (camera=(self))', async () => {
    expect(nextConfig.headers).toBeTypeOf('function');
    const headerGroups = await nextConfig.headers?.();
    const allHeaders = (headerGroups ?? []).flatMap((group) => group.headers);
    const permissionsPolicy = allHeaders.find((h) => h.key === 'Permissions-Policy');

    expect(permissionsPolicy).toBeDefined();
    expect(permissionsPolicy?.value).toContain('camera=(self)');
    // The empty allowlist would silently block same-origin camera access.
    expect(permissionsPolicy?.value).not.toMatch(/camera=\(\)/);
  });
});
