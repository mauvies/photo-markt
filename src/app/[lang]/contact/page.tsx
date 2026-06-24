import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

export default async function ContactPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const t = dict.contactPage;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-16 sm:py-20">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold sm:text-4xl">{t.title}</h1>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t.intro}</p>
      </header>

      {t.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {section.body}{' '}
            <a
              href={`mailto:${section.email}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {section.email}
            </a>
            .
          </p>
        </section>
      ))}

      <p className="text-sm leading-relaxed text-muted-foreground">{t.dashboardNote}</p>
    </div>
  );
}
