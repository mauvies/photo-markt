import { userHasRole } from '@/app/[lang]/actions/roles';
import { listSavedEvents } from '@/app/[lang]/actions/saved-events';
import { DashboardHeader } from '@/components/dashboard-header';
import { FavoritesTabs } from '@/components/favorites-tabs';
import { SavedEventsGrid } from '@/components/saved-events-grid';
import { createClient } from '@/database/server';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { listMyTaggedPhotos } from './actions';
import { TalentPhotosGrid } from './talent-photos-grid';

export default async function TalentFavoritesPage({
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

  if (!user) {
    return redirectToLogin();
  }

  // Gate by capability, not active view (active_role is a mutable UI preference).
  if (!(await userHasRole('talent'))) {
    return localizedRedirect(lang, '/dashboard');
  }

  const [photosResult, savedEventsResult] = await Promise.all([
    listMyTaggedPhotos({ limit: 50, offset: 0 }),
    listSavedEvents({ limit: 12, offset: 0 }),
  ]);

  const photosTab = (
    <TranslationsProvider translations={{ ...dict.talentPhotos, cancel: dict.common.cancel }}>
      <TalentPhotosGrid
        initialGroups={photosResult.groups}
        hasMore={photosResult.hasMore}
        photosInCart={photosResult.photosInCart}
        iconTooltips={dict.photoIconButtons}
        imageUnavailableLabel={dict.eventCard.imageUnavailable}
      />
    </TranslationsProvider>
  );

  const eventsTab = (
    <SavedEventsGrid
      initialEvents={savedEventsResult.events}
      initialHasMore={savedEventsResult.hasMore}
      eventLinkPrefix={`/${lang}/dashboard/talent/events`}
      activities={dict.activities}
      cardLabels={{
        photo: dict.eventCard.photo,
        photos: dict.eventCard.photos,
        noPhotosYet: dict.eventCard.noPhotosYet,
        comingSoon: dict.eventCard.comingSoon,
        imageUnavailable: dict.eventCard.imageUnavailable,
        share: dict.eventCard.share,
      }}
      labels={{
        emptyTitle: dict.savedEvents.emptyTitle,
        emptyBody: dict.savedEvents.emptyBody,
        loadMore: dict.savedEvents.loadMore,
        loading: dict.savedEvents.loading,
      }}
    />
  );

  return (
    <div>
      <DashboardHeader title={dict.talentDashboard.favorites} />
      <p className="text-sm text-muted-foreground">{dict.talentDashboard.favoritesSubtitle}</p>
      <FavoritesTabs
        photosLabel={dict.talentDashboard.favoritesTabPhotos}
        eventsLabel={dict.talentDashboard.favoritesTabEvents}
        photosTab={photosTab}
        eventsTab={eventsTab}
      />
    </div>
  );
}
