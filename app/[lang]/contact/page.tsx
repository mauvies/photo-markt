import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

export default async function ContactPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  return (
    <div className="mx-auto flex min-h-[60svh] w-full max-w-3xl flex-col gap-4 px-4 py-16 sm:py-20">
      <h1 className="text-3xl font-bold sm:text-4xl">{dict.staticPages.contactTitle}</h1>
      <p className="text-muted-foreground">{dict.staticPages.preparing}</p>
    </div>
  );
}
