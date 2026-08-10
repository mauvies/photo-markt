import { Clock, Download, UserPlus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getDownloadTokenByToken } from '@/database/queries/download-tokens';
import { getGuestOrderWithItems } from '@/database/queries/guest-orders';
import { supabaseAdmin } from '@/database/supabase-admin';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';

interface PhotoDownloadItem {
  photoId: string;
  originalPath: string;
  signedUrl: string;
  eventName: string | null;
}

export default async function DownloadPage({
  params,
}: {
  params: Promise<{ token: string; lang: string }>;
}) {
  const { token, lang } = await params;
  const dict = await getDictionary(lang as Locale);

  // Look up the token (admin client — no auth required for this endpoint)
  const downloadToken = await getDownloadTokenByToken(supabaseAdmin, token);

  if (!downloadToken) {
    notFound();
  }

  // Check expiry
  const isExpired = new Date(downloadToken.expires_at) < new Date();

  if (isExpired) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">{dict.download.expiredTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">{dict.download.expiredDesc}</p>
        <div className="mt-6 flex gap-3">
          <Link href={localizedPath(lang, '/login')}>
            <Button variant="outline">{dict.download.login}</Button>
          </Link>
          <Link href={localizedPath(lang, '/signup')}>
            <Button>{dict.download.createAccount}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Fetch the guest order and its items
  if (!downloadToken.guest_order_id) {
    // Future: handle authenticated order tokens
    notFound();
  }

  const guestOrder = await getGuestOrderWithItems(supabaseAdmin, downloadToken.guest_order_id);

  if (guestOrder?.status !== 'completed') {
    notFound();
  }

  // Generate fresh signed URLs (1-hour expiry, no watermark — purchase completed)
  const photoItems: PhotoDownloadItem[] = [];

  await Promise.all(
    guestOrder.items.map(async (item, index) => {
      // Get the photo's storage path
      const { data: photo } = await supabaseAdmin
        .from('photos')
        .select('original_url, events(name)')
        .eq('id', item.photo_id)
        .maybeSingle();

      if (!photo?.original_url) return;

      // ⚠️ The download has to be asked for HERE, when the URL is signed.
      // The markup already carries `<a download>`, but that attribute is
      // **ignored for cross-origin URLs** — and these point at Supabase Storage,
      // a different origin — so the browser navigated to the image instead and
      // the buyer had to save it by hand from a raw storage URL. Supabase's
      // `download` option sets `Content-Disposition: attachment` on the response,
      // which is honoured whatever the origin.
      const extension = photo.original_url.split('.').pop()?.toLowerCase() || 'jpg';
      const filename = `photo-markt-${index + 1}.${extension}`;

      const { data: signedData } = await supabaseAdmin.storage
        .from('photos')
        .createSignedUrl(photo.original_url, 3600, { download: filename });

      if (!signedData?.signedUrl) return;

      const event = Array.isArray(photo.events) ? photo.events[0] : photo.events;

      photoItems.push({
        photoId: item.photo_id,
        originalPath: photo.original_url,
        signedUrl: signedData.signedUrl,
        eventName: event?.name ?? null,
      });
    }),
  );

  const expiresAt = new Date(downloadToken.expires_at);
  const daysLeft = Math.max(
    0,
    Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  return (
    <div className="mx-auto max-w-[1300px] px-4 py-8 sm:px-6">
      {/* Account creation nudge */}
      {!downloadToken.claimed_by_user_id && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1 text-sm">
            <span className="font-medium">
              {dict.download.expiresSoon} {daysLeft}{' '}
              {daysLeft === 1 ? dict.download.day : dict.download.days}.{' '}
            </span>
            <span className="text-muted-foreground">{dict.download.keepPermanently}</span>
            <div className="mt-2">
              <Link href={localizedPath(lang, `/signup?token=${token}`)}>
                <Button size="sm" className="gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" />
                  {dict.download.createFreeAccount}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{dict.download.yourPhotos}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {photoItems.length} {photoItems.length === 1 ? dict.events.photo : dict.events.photos}{' '}
          {dict.download.readyToDownload} · {dict.download.linksValid}
        </p>
      </div>

      {/* Photo grid */}
      {photoItems.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          {dict.download.noPhotosFound}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photoItems.map((photo, i) => (
            <div key={photo.photoId} className="group overflow-hidden rounded-xl border bg-card">
              {/* Photo preview */}
              <div className="relative aspect-video w-full">
                <Image
                  src={photo.signedUrl}
                  alt={photo.eventName ?? `Photo ${i + 1}`}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  unoptimized
                />
              </div>
              <div className="p-3">
                {photo.eventName && (
                  <p className="mb-2 truncate text-xs text-muted-foreground">{photo.eventName}</p>
                )}
                <a href={photo.signedUrl} download={`photo-markt-photo-${i + 1}.jpg`}>
                  <Button size="sm" className="w-full gap-2" variant="outline">
                    <Download className="h-3.5 w-3.5" />
                    {dict.download.download}
                  </Button>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
