import { CheckCircle2, Download, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getDownloadTokenByGuestOrderId } from '@/database/queries/download-tokens';
import { getGuestOrderBySessionId } from '@/database/queries/guest-orders';
import { supabaseAdmin } from '@/database/supabase-admin';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { stripe } from '@/lib/stripe/config';
import { ClearGuestCart } from './clear-guest-cart';

export default async function GuestCheckoutSuccessPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { lang } = await routeParams;
  const dict = await getDictionary(lang as Locale);
  const { session_id } = await searchParams;

  if (!session_id) {
    localizedRedirect(lang, '/events');
  }

  // Verify the Stripe session
  let sessionEmail: string | null = null;
  let photoCount = 0;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id as string, {
      expand: ['line_items'],
    });

    sessionEmail = session.customer_details?.email ?? null;
    photoCount = session.line_items?.data.length ?? 0;
  } catch {
    localizedRedirect(lang, '/events');
  }

  // Find the guest order and download token
  const guestOrder = await getGuestOrderBySessionId(supabaseAdmin, session_id);

  const downloadToken = guestOrder
    ? await getDownloadTokenByGuestOrderId(supabaseAdmin, guestOrder.id)
    : null;

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4">
      <ClearGuestCart />

      <div className="w-full max-w-md text-center">
        {/* Success icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
          <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
        </div>

        <h1 className="text-2xl font-semibold">{dict.checkout.successTitle}</h1>
        <p className="mt-3 text-muted-foreground">
          {dict.checkout.purchased}{' '}
          <strong>
            {photoCount} {photoCount === 1 ? dict.events.photo : dict.events.photos}
          </strong>
          .
          {sessionEmail && (
            <>
              {' '}
              {dict.checkout.downloadLinkSent} <strong>{sessionEmail}</strong>.
            </>
          )}
        </p>

        {/* Download CTA */}
        {downloadToken ? (
          <Link
            href={localizedPath(lang, `/download/${downloadToken.token}`)}
            className="mt-8 block"
          >
            <Button size="lg" className="w-full gap-2">
              <Download className="h-5 w-5" />
              {dict.checkout.viewDownloadPhotos}
            </Button>
          </Link>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">{dict.checkout.downloadLinkEmail}</p>
        )}

        {/* Account signup nudge */}
        <div className="mt-6 rounded-xl border bg-card p-5 text-left">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-sm">{dict.checkout.savePhotosTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {dict.checkout.savePhotosDesc}
              </p>
              <Link
                href={
                  downloadToken
                    ? localizedPath(lang, `/signup?token=${downloadToken.token}`)
                    : localizedPath(lang, '/signup')
                }
                className="mt-3 inline-block"
              >
                <Button variant="outline" size="sm" className="gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" />
                  {dict.checkout.createFreeAccount}
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link href={localizedPath(lang, '/events')} className="hover:underline">
            {dict.checkout.continueBrowsing}
          </Link>
        </p>
      </div>
    </div>
  );
}
