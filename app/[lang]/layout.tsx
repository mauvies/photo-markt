import { Suspense } from 'react';
import { ConditionalFooter } from '@/components/conditional-footer';
import { ConditionalHeader } from '@/components/conditional-header';
import { Footer } from '@/components/footer';
import { GuestCartMerge } from '@/components/guest-cart-merge';
import { GuestCartProvider } from '@/components/guest-cart-provider';
import { HtmlLangSync } from '@/components/html-lang-sync';
import { Main } from '@/components/main';
import { Nav } from '@/components/nav';
import { QueryProvider } from '@/components/query-provider';
import { SavedEventsLabelsProvider } from '@/components/saved-events-labels-provider';
import { ScrollToTop } from '@/components/scroll-to-top';
import { Toaster } from '@/components/ui/sonner';
import { type Locale, locales } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  return (
    <QueryProvider>
      <SavedEventsLabelsProvider labels={dict.savedEvents}>
        <HtmlLangSync lang={lang} />
        <ScrollToTop />
        <GuestCartProvider>
          <GuestCartMerge cartRestoredMessage={dict.cart.cartRestored} />
          <ConditionalHeader>
            <TranslationsProvider translations={dict.nav}>
              {/* Nav reads `useSearchParams()` (login-href + language switcher);
                the Suspense boundary keeps the surrounding page statically
                prerenderable. The fallback reserves the header height so the
                client-rendered nav doesn't shift the page. */}
              <Suspense
                fallback={
                  <div className="sticky top-0 z-50 h-(--header-height) w-full border-b bg-background/80 backdrop-blur" />
                }
              >
                <Nav />
              </Suspense>
            </TranslationsProvider>
          </ConditionalHeader>
          <Main>{children}</Main>
          <ConditionalFooter>
            <Footer dict={dict} lang={lang} />
          </ConditionalFooter>
          <Toaster />
        </GuestCartProvider>
      </SavedEventsLabelsProvider>
    </QueryProvider>
  );
}
