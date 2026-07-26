import { AvatarUpload } from '@/components/avatar-upload';
import { ProfileForm } from '@/components/profile-form';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getProfileData } from '../actions';
import { updateProfileAction } from '../update-action';

export default async function TalentSettingsProfilePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const { profile } = await getProfileData();

  if (!profile) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">{dict.talentDashboard.profileNotFound}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-4 text-lg font-semibold sm:text-xl">
        {dict.talentDashboard.profileDetails}
      </h2>
      <div className="mb-6">
        <h3 className="text-sm font-medium">{dict.avatarUpload.sectionTitle}</h3>
        <p className="mb-3 text-sm text-muted-foreground">{dict.avatarUpload.sectionDescription}</p>
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
  );
}
