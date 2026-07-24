import { describe, expect, it } from 'vitest';
import {
  buildRevealCookieValue,
  REVEAL_COOKIE_TTL_SECONDS,
  REVEAL_MAX_PHOTO_IDS,
  readRevealedPhotoIds,
  revealCookieName,
} from '@/lib/reveal-token';

const EVENT = 'a1b2c3d4-0000-4000-8000-000000000001';
const OTHER_EVENT = 'a1b2c3d4-0000-4000-8000-000000000002';
const NOW = 1_800_000_000;

describe('reveal-token', () => {
  it('round-trips the proven photo ids for the same event', () => {
    const cookie = buildRevealCookieValue(EVENT, ['p1', 'p2', 'p3'], NOW);
    const ids = readRevealedPhotoIds(cookie, EVENT, NOW);
    expect([...ids].sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('names the cookie per event', () => {
    expect(revealCookieName(EVENT)).toBe(`pm_reveal_${EVENT}`);
    expect(revealCookieName(EVENT)).not.toBe(revealCookieName(OTHER_EVENT));
  });

  it('returns empty for a missing cookie (fail-closed)', () => {
    expect(readRevealedPhotoIds(undefined, EVENT, NOW).size).toBe(0);
    expect(readRevealedPhotoIds(null, EVENT, NOW).size).toBe(0);
    expect(readRevealedPhotoIds('', EVENT, NOW).size).toBe(0);
  });

  it('rejects a tampered signature', () => {
    const cookie = buildRevealCookieValue(EVENT, ['p1'], NOW);
    const [body] = cookie.split('.');
    const forged = `${body}.deadbeef`;
    expect(readRevealedPhotoIds(forged, EVENT, NOW).size).toBe(0);
  });

  it('rejects a tampered body (added photo id)', () => {
    const cookie = buildRevealCookieValue(EVENT, ['p1'], NOW);
    const sig = cookie.slice(cookie.lastIndexOf('.') + 1);
    // Re-encode a body that claims an extra id, keeping the old signature.
    const forgedBody = Buffer.from(`${EVENT}.p1,p2.${NOW + REVEAL_COOKIE_TTL_SECONDS}`).toString(
      'base64url',
    );
    expect(readRevealedPhotoIds(`${forgedBody}.${sig}`, EVENT, NOW).size).toBe(0);
  });

  it('rejects a cookie minted for a different event', () => {
    const cookie = buildRevealCookieValue(OTHER_EVENT, ['p1'], NOW);
    expect(readRevealedPhotoIds(cookie, EVENT, NOW).size).toBe(0);
  });

  it('rejects an expired cookie', () => {
    const cookie = buildRevealCookieValue(EVENT, ['p1'], NOW);
    const afterExpiry = NOW + REVEAL_COOKIE_TTL_SECONDS + 1;
    expect(readRevealedPhotoIds(cookie, EVENT, afterExpiry).size).toBe(0);
  });

  it('caps the stored id set', () => {
    const many = Array.from({ length: REVEAL_MAX_PHOTO_IDS + 50 }, (_, i) => `photo-${i}`);
    const cookie = buildRevealCookieValue(EVENT, many, NOW);
    const ids = readRevealedPhotoIds(cookie, EVENT, NOW);
    expect(ids.size).toBe(REVEAL_MAX_PHOTO_IDS);
  });

  it('yields empty for a match with no photos', () => {
    const cookie = buildRevealCookieValue(EVENT, [], NOW);
    expect(readRevealedPhotoIds(cookie, EVENT, NOW).size).toBe(0);
  });
});
