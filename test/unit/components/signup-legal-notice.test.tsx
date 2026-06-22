/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SignupLegalNotice } from '@/components/signup-legal-notice';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';

afterEach(cleanup);

describe('SignupLegalNotice', () => {
  it('links Terms of Service to the localized /terms page', () => {
    render(<SignupLegalNotice dict={en.signup} lang="en" />);
    const terms = screen.getByRole('link', { name: en.signup.termsLabel });
    expect(terms.getAttribute('href')).toBe('/en/terms');
  });

  it('links Privacy Policy to the localized /privacy-policy page', () => {
    render(<SignupLegalNotice dict={en.signup} lang="en" />);
    const privacy = screen.getByRole('link', { name: en.signup.privacyLabel });
    expect(privacy.getAttribute('href')).toBe('/en/privacy-policy');
  });

  it('localizes the link hrefs for Spanish', () => {
    render(<SignupLegalNotice dict={es.signup} lang="es" />);
    expect(screen.getByRole('link', { name: es.signup.termsLabel }).getAttribute('href')).toBe(
      '/es/terms',
    );
    expect(screen.getByRole('link', { name: es.signup.privacyLabel }).getAttribute('href')).toBe(
      '/es/privacy-policy',
    );
  });

  it('no longer attributes our terms to Supabase', () => {
    const { container } = render(<SignupLegalNotice dict={en.signup} lang="en" />);
    expect(container.textContent).not.toContain('Supabase');
    expect(container.textContent).toContain("Photo Markt's");
  });
});

describe('signup legal-notice dictionary', () => {
  const keys = [
    'termsNoticePrefix',
    'termsLabel',
    'termsNoticeMiddle',
    'privacyLabel',
    'termsNoticeSuffix',
  ] as const;

  it('has all segment keys, non-empty, in both locales', () => {
    for (const dict of [en.signup, es.signup]) {
      for (const key of keys) {
        expect((dict as Record<string, string>)[key]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('dropped the legacy "termsNotice" key and the Supabase attribution', () => {
    expect('termsNotice' in en.signup).toBe(false);
    expect('termsNotice' in es.signup).toBe(false);
    expect(JSON.stringify(en.signup)).not.toContain('Supabase');
    expect(JSON.stringify(es.signup)).not.toContain('Supabase');
  });

  it('is translated (ES differs from EN on the labels)', () => {
    expect(es.signup.termsLabel).not.toBe(en.signup.termsLabel);
    expect(es.signup.privacyLabel).not.toBe(en.signup.privacyLabel);
  });
});
