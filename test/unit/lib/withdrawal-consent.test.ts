import { describe, expect, it } from 'vitest';
import {
  buildWithdrawalConsentMetadata,
  parseWithdrawalConsentMetadata,
  WITHDRAWAL_CONSENT_AT_KEY,
  WITHDRAWAL_CONSENT_VERSION,
  WITHDRAWAL_CONSENT_VERSION_KEY,
} from '@/lib/withdrawal-consent';

describe('withdrawal consent metadata (T-228)', () => {
  it('round-trips a stamped consent through Stripe session metadata', () => {
    const now = new Date('2026-08-05T10:30:00.000Z');

    const parsed = parseWithdrawalConsentMetadata(buildWithdrawalConsentMetadata(now));

    expect(parsed).toEqual({
      acceptedAt: '2026-08-05T10:30:00.000Z',
      version: WITHDRAWAL_CONSENT_VERSION,
    });
  });

  it('stamps the current version, not one supplied by the caller', () => {
    const metadata = buildWithdrawalConsentMetadata(new Date('2026-08-05T00:00:00.000Z'));

    expect(metadata[WITHDRAWAL_CONSENT_VERSION_KEY]).toBe(WITHDRAWAL_CONSENT_VERSION);
  });

  // Every one of these means "no consent on record". None may ever be read as
  // "assume consent" — the order row would then assert evidence we don't have.
  it.each([
    ['null metadata', null],
    ['undefined metadata', undefined],
    ['empty metadata (session created before the gate shipped)', {}],
    ['timestamp without version', { [WITHDRAWAL_CONSENT_AT_KEY]: '2026-08-05T10:30:00.000Z' }],
    ['version without timestamp', { [WITHDRAWAL_CONSENT_VERSION_KEY]: '2026-08-05' }],
    [
      'unparseable timestamp',
      {
        [WITHDRAWAL_CONSENT_AT_KEY]: 'yesterday-ish',
        [WITHDRAWAL_CONSENT_VERSION_KEY]: '2026-08-05',
      },
    ],
    [
      'empty-string values',
      { [WITHDRAWAL_CONSENT_AT_KEY]: '', [WITHDRAWAL_CONSENT_VERSION_KEY]: '' },
    ],
  ])('fails closed to null: %s', (_label, metadata) => {
    expect(parseWithdrawalConsentMetadata(metadata)).toBeNull();
  });
});
