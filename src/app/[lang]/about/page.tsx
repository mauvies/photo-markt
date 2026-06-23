import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

export default async function AboutPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const t = dict.aboutPage;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-16 sm:py-20">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold sm:text-4xl">{t.title}</h1>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t.intro}</p>
      </header>

      {t.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{section.body}</p>
          {section.bullets.length > 0 && (
            <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-muted-foreground">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t.contactTitle}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t.contactBody}{' '}
          <a
            href={`mailto:${t.contactEmail}`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {t.contactEmail}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
