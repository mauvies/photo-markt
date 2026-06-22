import Link from 'next/link';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';

/**
 * Consent line under the signup form. The copy is split into segments
 * (prefix · terms link · middle · privacy link · suffix) rather than
 * concatenated around fixed links, so each locale controls word order — e.g.
 * EN puts "Photo Markt's" in the prefix while ES puts "de Photo Markt" in the
 * suffix. Links point at our own /terms and /privacy-policy (localized).
 */
export function SignupLegalNotice({ dict, lang }: { dict: Dictionary['signup']; lang: string }) {
  const linkClass = 'font-medium text-foreground underline underline-offset-2 hover:text-primary';

  return (
    <p className="mt-4 text-center text-xs text-muted-foreground">
      {dict.termsNoticePrefix}
      <Link href={localizedPath(lang, '/terms')} className={linkClass}>
        {dict.termsLabel}
      </Link>
      {dict.termsNoticeMiddle}
      <Link href={localizedPath(lang, '/privacy-policy')} className={linkClass}>
        {dict.privacyLabel}
      </Link>
      {dict.termsNoticeSuffix}
    </p>
  );
}
