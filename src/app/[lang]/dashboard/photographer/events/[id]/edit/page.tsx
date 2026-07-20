import { DashboardHeader } from '@/components/dashboard-header';
import { getEvent } from '@/database/queries';
import { createSignedUrl } from '@/database/queries/storage';
import type { SupabaseServerClient } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { EditEventForm } from './edit-event-form';
import { getEditEventPhotos } from './photo-data';

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  const [supabase, dict] = await Promise.all([createClient(), getDictionary(lang as Locale)]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToLogin();
  }

  // Ownership gate via the user-scoped client. `getEvent` filters by user_id,
  // so a non-owner gets `null` and is bounced out.
  const event = await getEvent(supabase, id, user.id);

  if (!event) {
    localizedRedirect(lang, '/dashboard/photographer/events');
  }

  // Fetch + sign the existing photos with the service-role client. The `photos`
  // bucket is private with no storage RLS for `authenticated`, so signing with
  // the user-scoped client returns null URLs → "No preview" for every photo
  // (T-063). Ownership was already verified above.
  const photosWithUrls = await getEditEventPhotos(
    supabaseAdmin as unknown as SupabaseServerClient,
    id,
    user.id,
  );

  // Sign the dedicated cover (T-055/T-166) for the edit form's initial preview.
  // A dedicated cover is always direct-signed (promotional image, not a for-sale
  // photo). `getEvent` selects `*`, so `cover_path` is present at runtime even
  // though the `Event` type doesn't declare it (read defensively, like the AI
  // columns). Sign with the service-role client — the `photos` bucket is private.
  const coverPath = (event as unknown as Record<string, unknown>).cover_path as
    | string
    | null
    | undefined;
  const initialCoverUrl = coverPath
    ? await createSignedUrl(supabaseAdmin as unknown as SupabaseServerClient, 'photos', coverPath)
    : null;

  return (
    <div>
      <DashboardHeader title="Edit Event" />
      <p className="mt-1 text-sm text-muted-foreground">
        Update your event details and manage photos.
      </p>
      <div className="mt-6">
        <TranslationsProvider translations={dict.newEvent}>
          <EditEventForm
            event={event}
            initialPhotos={photosWithUrls}
            initialCoverUrl={initialCoverUrl}
          />
        </TranslationsProvider>
      </div>
    </div>
  );
}
