import { getActiveRole } from '@/app/[lang]/actions/roles';
import { DashboardHeader } from '@/components/dashboard-header';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getCurrentCart } from './actions';
import { CartContent } from './cart-content';
import { CartPurchaseSuccess } from './cart-purchase-success';

export const dynamic = 'force-dynamic';

interface CartPageProps {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ status?: string }>;
}

export default async function CartPage({ params: routeParams, searchParams }: CartPageProps) {
  const { lang } = await routeParams;
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return localizedRedirect(lang, '/login');
  }

  // Ensure user is in talent role
  const { activeRole } = await getActiveRole();
  if (activeRole !== 'talent') {
    return localizedRedirect(lang, '/dashboard');
  }

  const params = await searchParams;
  const status = params.status;

  // If success, use client component to invalidate cart-count query before navigating
  if (status === 'success') {
    return <CartPurchaseSuccess lang={lang} />;
  }

  const cartData = await getCurrentCart();

  return (
    <div className="space-y-6">
      <div>
        <DashboardHeader title={dict.talentDashboard.shoppingCart} />
        <p className="text-sm text-muted-foreground mt-1">{dict.talentDashboard.reviewPhotos}</p>
      </div>
      <TranslationsProvider translations={dict.cart}>
        <CartContent initialCartData={cartData} />
      </TranslationsProvider>
    </div>
  );
}
