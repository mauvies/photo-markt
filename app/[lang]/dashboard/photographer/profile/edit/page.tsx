import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DashboardHeader } from '@/components/dashboard-header';
import { ProfileForm } from '@/components/profile-form';
import { buttonVariants } from '@/components/ui/button-variants';
import { getProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { updateProfileAction } from '../update-action';

export default async function PhotographerProfileEditPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const profile = await getProfile(supabase, user.id);
  if (!profile) {
    return (
      <div className="flex flex-1 flex-col px-3 py-4 sm:px-4 sm:py-6">
        <DashboardHeader title={dict.photographerProfile.editProfileTitle} />
        <div className="mt-8 text-center">
          <p className="text-muted-foreground">{dict.photographerDashboard.profileNotFound}</p>
        </div>
      </div>
    );
  }

  // Back-link returns to the dashboard-wrapped preview so the photographer
  // stays inside the dashboard chrome. The public URL is reachable via
  // the "Copy profile link" button on the preview itself.
  const backHref = `/${lang}/dashboard/photographer/profile/preview`;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          <Link
            href={backHref}
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {dict.photographerProfile.backToProfile}
          </Link>
          <div className="mt-2">
            <DashboardHeader title={dict.photographerProfile.editProfileTitle} />
            <p className="text-sm text-muted-foreground">
              {dict.photographerProfile.editProfileSubtitle}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
          <TranslationsProvider translations={dict.profileForm}>
            <ProfileForm
              initialValues={{
                username: profile.username,
                display_name: profile.display_name,
                bio: profile.bio,
              }}
              onSubmit={updateProfileAction}
            />
          </TranslationsProvider>
        </div>
      </div>
    </div>
  );
}
