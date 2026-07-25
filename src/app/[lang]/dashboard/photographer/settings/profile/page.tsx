import { redirect } from 'next/navigation';
import { AvatarUpload } from '@/components/avatar-upload';
import { ProfileForm } from '@/components/profile-form';
import { getProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { updateProfileAction } from '../../profile/update-action';

export default async function PhotographerSettingsProfilePage({
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
      <div className="text-center py-12">
        <p className="text-muted-foreground">{dict.photographerDashboard.profileNotFound}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h2 className="text-lg font-semibold sm:text-xl">
          {dict.photographerProfile.editProfileTitle}
        </h2>
        <p className="text-sm text-muted-foreground">
          {dict.photographerProfile.editProfileSubtitle}
        </p>
      </div>
      <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-6">
          <h3 className="text-sm font-medium">{dict.avatarUpload.sectionTitle}</h3>
          <p className="mb-3 text-sm text-muted-foreground">
            {dict.avatarUpload.sectionDescription}
          </p>
          <AvatarUpload
            currentAvatarUrl={profile.avatar_url ?? null}
            fallbackText={(profile.display_name || profile.username || '?').charAt(0).toUpperCase()}
            labels={dict.avatarUpload}
          />
        </div>
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
  );
}
