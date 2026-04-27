import { Facebook, Instagram, Mail, Twitter } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';

export function Footer({ dict, lang }: { dict: Dictionary; lang: string }) {
  const t = dict.footer;
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-3">
            <Link href={localizedPath(lang, '/')} className="flex items-center gap-2">
              <Image src="/logo.svg" alt="Picdemi" className="h-12 w-auto" width={80} height={80} />
            </Link>
            <p className="text-sm text-muted-foreground -mt-3">{t.tagline}</p>
            <div className="flex items-center gap-4">
              <a
                // biome-ignore lint/a11y/useValidAnchor: explanation
                href="#"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Twitter"
              >
                <Twitter className="h-5 w-5" />
              </a>
              <a
                // biome-ignore lint/a11y/useValidAnchor: explanation
                href="#"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>
              <a
                // biome-ignore lint/a11y/useValidAnchor: explanation
                href="#"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Facebook"
              >
                <Facebook className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Product */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">{t.productTitle}</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href={localizedPath(lang, '/signup')}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.getStarted}
                </Link>
              </li>
              <li>
                <Link
                  href={localizedPath(lang, '/login')}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.signIn}
                </Link>
              </li>
              <li>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: explanation
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.pricing}
                </a>
              </li>
              <li>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: explanation
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.features}
                </a>
              </li>
            </ul>
          </div>

          {/* For Photographers */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">{t.photographersTitle}</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: explanation
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.uploadPhotos}
                </a>
              </li>
              <li>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: explanation
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.setPricing}
                </a>
              </li>
              <li>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: explanation
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.resources}
                </a>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">{t.supportTitle}</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: explanation
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.helpCenter}
                </a>
              </li>
              <li>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: explanation
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.contactUs}
                </a>
              </li>
              <li>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: explanation
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.privacyPolicy}
                </a>
              </li>
              <li>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: explanation
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.termsOfService}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t pt-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Picdemi. {t.allRightsReserved}
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              <a
                href="mailto:hello@picdemi.com"
                className="hover:text-foreground transition-colors"
              >
                hello@picdemi.com
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
