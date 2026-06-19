import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { PrivateEventForm } from './private-event-form';

export default async function PrivateEventPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const t = dict.privateEvent;

  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <PrivateEventForm labels={{ placeholder: t.placeholder, button: t.button }} />
      </div>
    </div>
  );
}
