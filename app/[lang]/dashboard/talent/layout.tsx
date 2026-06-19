import { getActiveRoleOrNull, userHasRole } from '@/app/[lang]/actions/roles';
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

  const [profile, currentRole, hasTalent] = await Promise.all([
    getProfileFields(supabase, user?.id ?? '', ['display_name']),
    getActiveRoleOrNull(),
    userHasRole('talent'),
  ]);

  // No chosen role yet → onboarding, instead of relying on a minted profile.
  if (!currentRole) {
    return localizedRedirect(lang, '/onboarding/role');
  }

  // Gate by capability — never write active_role on render. A background
  // prefetch / multi-tab render must not be able to flip the user's role.
  // This is the talent layout, so the view is talent by definition.
  if (!hasTalent) {
    return localizedRedirect(lang, '/dashboard');
  }

  const activeRole = 'talent';

  const sidebarUser = {
    name: profile?.display_name ?? user?.user_metadata?.full_name ?? user?.email ?? 'Member',
    email: user?.email ?? '',
    avatar: user?.user_metadata?.avatar_url ?? null,
  };

  return (
    // On mobile the header is hidden (its cart moves to the bottom nav) to free
    // vertical space, so the in-dashboard sticky toolbars must offset by 0
    // instead of the header height. Scoping --header-height here cascades that
    // to every sticky toolbar in the talent dashboard without touching each one;
    // public pages keep the global value.
    <div className="flex min-h-svh flex-col [--header-height:0px] md:[--header-height:4.5rem]">
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
          cart: dict.nav.cart,
        }}
      />
      <div className="mx-auto w-full max-w-screen-2xl flex flex-1 flex-col gap-6 px-3 py-5 pb-20 md:p-6">
        {children}
      </div>
    </div>
  );
}
