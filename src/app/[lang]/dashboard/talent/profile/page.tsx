import { requireUser } from '@/lib/auth/require-user';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getProfileData } from './actions';
import { ProfileContent } from './profile-content';

interface TalentProfilePageProps {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ purchased?: string }>;
}

export default async function TalentProfilePage({ params, searchParams }: TalentProfilePageProps) {
  // Guard first: this page renders in parallel with the layouts above it, so
  // their login redirects don't stop it, and `getProfileData()` throws without a
  // session — that error would race them into the error boundary (T-198).
  await requireUser();

  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const data = await getProfileData();
  const searchParamsData = await searchParams;
  const showSuccessMessage = searchParamsData.purchased === 'true';

  return (
    <div className="flex flex-1 flex-col">
      <ProfileContent
        initialData={data}
        showSuccessMessage={showSuccessMessage}
        translations={{
          ...dict.profilePhotoViewer,
          imageUnavailable: dict.eventCard.imageUnavailable,
        }}
      />
    </div>
  );
}
