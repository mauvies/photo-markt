import { SupportPage } from '@/components/support-page';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

export default async function TalentSupportPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  return (
    <TranslationsProvider translations={dict.support}>
      <SupportPage userRole="talent" />
    </TranslationsProvider>
  );
}
