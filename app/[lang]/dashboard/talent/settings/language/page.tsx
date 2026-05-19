import { LanguageSwitcher } from '@/components/language-switcher';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

export default async function TalentSettingsLanguagePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
      <div>
        <h2 className="text-lg font-semibold sm:text-xl">{dict.settings.language.heading}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{dict.settings.language.description}</p>
      </div>
      <LanguageSwitcher inline />
    </section>
  );
}
