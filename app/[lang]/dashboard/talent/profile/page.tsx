import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getProfileData } from './actions';
import { ProfileContent } from './profile-content';

interface TalentProfilePageProps {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ purchased?: string }>;
}

export default async function TalentProfilePage({ params, searchParams }: TalentProfilePageProps) {
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
        translations={dict.profilePhotoViewer}
      />
    </div>
  );
}
