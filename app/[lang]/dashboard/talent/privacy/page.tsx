import { Shield } from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard-header';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

interface TalentPrivacyPageProps {
  params: Promise<{ lang: string }>;
}

/**
 * Static privacy disclosure for the AI face-search feature. Linked from the
 * talent dashboard sidebar and from the search-modal disclaimer copy.
 *
 * No DB queries, no Server Actions — purely informational. We do NOT store
 * selfies or biometric embeddings derived from a search; the only relevant
 * server-side records are search-event logs used for rate-limiting.
 */
export default async function TalentPrivacyPage({ params }: TalentPrivacyPageProps) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const t = dict.privacy;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Shield className="h-5 w-5" aria-hidden="true" />
        </span>
        <DashboardHeader title={t.title} />
      </div>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{t.howItWorksTitle}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t.howItWorksBody}</p>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{t.whatWeStoreTitle}</h2>
        <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-muted-foreground">
          <li>{t.whatWeStoreBullet1}</li>
          <li>{t.whatWeStoreBullet2}</li>
          <li>{t.whatWeStoreBullet3}</li>
        </ul>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{t.gdprTitle}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t.gdprBody}{' '}
          <a
            href={`mailto:${t.gdprContact}`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {t.gdprContact}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
