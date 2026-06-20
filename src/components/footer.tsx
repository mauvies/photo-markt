import Image from 'next/image';
import Link from 'next/link';
import { FacebookIcon, InstagramIcon, XIcon } from '@/components/brand-icons';
import { CookiePreferencesButton } from '@/components/cookie-preferences-button';
import { LanguageSwitcher } from '@/components/language-switcher';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';

/**
 * Social profiles. Photo Markt has no public social accounts yet — drop the
 * real URLs in here once they exist and the icons turn into live links
 * automatically. An empty string keeps the icon visually present but
 * non-functional (rendered as a plain, non-clickable element).
 */
const SOCIAL_LINKS: Record<'instagram' | 'twitter' | 'facebook', string> = {
  instagram: '',
  twitter: '',
  facebook: '',
};

export function Footer({ dict, lang }: { dict: Dictionary; lang: string }) {
  const t = dict.footer;
  const lp = (path: string) => localizedPath(lang, path);

  const groups = [
    {
      title: t.productTitle,
      links: [
        { label: t.howItWorks, href: lp('/#how-it-works') },
        { label: t.pricing, href: lp('/#pricing') },
      ],
    },
    {
      title: t.photographersTitle,
      links: [
        { label: t.becomePhotographer, href: lp('/signup') },
        { label: t.photographerPricing, href: lp('/#pricing') },
      ],
    },
    {
      title: t.athletesTitle,
      links: [
        { label: t.browseEvents, href: lp('/events') },
        { label: t.createAccount, href: lp('/signup') },
      ],
    },
    {
      title: t.companyTitle,
      links: [
        { label: t.about, href: lp('/about') },
        { label: t.contact, href: lp('/contact') },
      ],
    },
    {
      title: t.legalTitle,
      links: [
        { label: t.terms, href: lp('/terms') },
        { label: t.privacy, href: lp('/privacy-policy') },
      ],
    },
  ];

  const socials = [
    { key: 'instagram', label: 'Instagram', Icon: InstagramIcon, href: SOCIAL_LINKS.instagram },
    { key: 'twitter', label: 'X (Twitter)', Icon: XIcon, href: SOCIAL_LINKS.twitter },
    { key: 'facebook', label: 'Facebook', Icon: FacebookIcon, href: SOCIAL_LINKS.facebook },
  ];

  return (
    <footer className="border-t bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-12">
          {/* Brand */}
          <div className="space-y-4 lg:col-span-4">
            <Link href={lp('/')} className="inline-flex items-center">
              <Image
                src="/logo.svg"
                alt="Photo Markt"
                className="h-9 w-auto"
                width={90}
                height={90}
              />
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{t.tagline}</p>
            <div className="flex items-center gap-3">
              {socials.map(({ key, label, Icon, href }) =>
                href ? (
                  <a
                    key={key}
                    href={href}
                    aria-label={label}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Icon className="h-5 w-5" />
                  </a>
                ) : (
                  // Non-functional until a real URL is set in SOCIAL_LINKS.
                  <span key={key} title={label} className="text-muted-foreground">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                ),
              )}
            </div>
          </div>

          {/* Link groups */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-8 lg:grid-cols-5">
            {groups.map((group) => (
              <div key={group.title} className="space-y-3">
                <h3 className="text-sm font-semibold">{group.title}</h3>
                <ul className="space-y-2 text-sm">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col items-center gap-4 border-t pt-8 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Photo Markt. {t.allRightsReserved}
          </p>
          <div className="flex items-center gap-4">
            <CookiePreferencesButton label={dict.cookieConsent.preferencesLabel} />
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </footer>
  );
}
