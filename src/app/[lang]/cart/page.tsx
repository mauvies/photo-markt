import { Suspense } from 'react';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { GuestCartContent } from './guest-cart-content';

export default async function GuestCartPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;

  // Authenticated users have a proper cart in the dashboard
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    return localizedRedirect(lang, '/dashboard/talent/cart');
  }

  const dict = await getDictionary(lang as Locale);

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:py-10 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-3xl font-bold">{dict.cart.shoppingCart}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{dict.cart.reviewPhotos}</p>
      </div>
      <Suspense>
        <TranslationsProvider translations={dict.cart}>
          <GuestCartContent />
        </TranslationsProvider>
      </Suspense>
    </div>
  );
}
