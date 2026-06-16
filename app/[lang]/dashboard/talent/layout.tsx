import { getActiveRoleOrNull, switchRole } from '@/app/[lang]/actions/roles';
import { TalentDashboardHeader } from '@/components/talent-dashboard-header';
import { getProfileFields } from '@/database/queries';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedRedirect } from '@/lib/i18n/redirect';

export default async function TalentLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLangFromHeaders();
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profile, currentRole] = await Promise.all([
    getProfileFields(supabase, user?.id ?? '', ['display_name', 'active_role']),
    getActiveRoleOrNull(),
  ]);

  // No chosen role yet → onboarding, instead of relying on a minted profile.
  if (!currentRole) {
    return localizedRedirect(lang, '/onboarding/role');
  }

  let activeRole = currentRole;
  if (activeRole !== 'talent') {
    await switchRole('talent', { skipRevalidation: true });
    activeRole = 'talent';
  }

  const sidebarUser = {
    name: profile?.display_name ?? user?.user_metadata?.full_name ?? user?.email ?? 'Member',
    email: user?.email ?? '',
    avatar: user?.user_metadata?.avatar_url ?? null,
  };

  return (
    <div className="flex min-h-svh flex-col">
      <TalentDashboardHeader
        user={sidebarUser}
        activeRole={activeRole}
        navLabels={{
          explore: dict.nav.explore,
          myPhotos: dict.nav.favorites,
          orders: dict.nav.orders,
          profile: dict.nav.profile,
          privacy: dict.nav.privacy,
          settings: dict.dashboard.settings,
          billing: dict.dashboard.billing,
          support: dict.dashboard.support,
          feedback: dict.dashboard.feedback,
          activeRole: dict.dashboard.activeRole,
          switchTo: dict.dashboard.switchTo,
          logOut: dict.dashboard.logOut,
          rolePhotographer: dict.photographerDashboard.rolePhotographer,
          roleTalent: dict.talentDashboard.talentRole,
          account: dict.dashboard.account,
        }}
      />
      <div className="mx-auto w-full max-w-screen-2xl flex flex-1 flex-col gap-6 p-4 py-6 pb-20 md:p-6">
        {children}
      </div>
    </div>
  );
}
