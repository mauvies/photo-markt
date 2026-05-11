import { getActiveRole } from '@/app/[lang]/actions/roles';
import { DashboardHeader } from '@/components/dashboard-header';
import { createClient } from '@/database/server';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { listMyTaggedPhotos } from './actions';
import { TalentPhotosGrid } from './talent-photos-grid';

export default async function TalentPhotosPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToLogin();
  }

  // Ensure user is in talent role
  const { activeRole } = await getActiveRole();
  if (activeRole !== 'talent') {
    return localizedRedirect(lang, '/dashboard');
  }

  const result = await listMyTaggedPhotos({ limit: 50, offset: 0 });

  return (
    <div>
      <DashboardHeader title={dict.talentDashboard.myPhotos} />
      <p className="text-sm text-muted-foreground">{dict.talentDashboard.myPhotosSubtitle}</p>
      <TranslationsProvider translations={{ ...dict.talentPhotos, cancel: dict.common.cancel }}>
        <TalentPhotosGrid
          initialGroups={result.groups}
          hasMore={result.hasMore}
          photosInCart={result.photosInCart}
          iconTooltips={dict.photoIconButtons}
          imageUnavailableLabel={dict.eventCard.imageUnavailable}
        />
      </TranslationsProvider>
    </div>
  );
}
