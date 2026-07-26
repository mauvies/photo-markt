import { getRoleContext } from '@/app/[lang]/actions/roles';
import { AppSidebar } from '@/components/app-sidebar';
import { DashboardTopHeader } from '@/components/dashboard-top-header';
import { PhotographerBottomNav } from '@/components/photographer-bottom-nav';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getProfileFields } from '@/database/queries';
import { createClient, getUser } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedRedirect } from '@/lib/i18n/redirect';

export default async function PhotographerLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLangFromHeaders();
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();
  const user = await getUser();

  // Both the active-role preference and the set of held roles come from a
  // single auth round-trip via getRoleContext() (see T-095) instead of the
  // former getActiveRoleOrNull + userHasRole pair that re-authenticated twice.
  const [profile, { activeRole: currentRole, heldRoles }] = await Promise.all([
    getProfileFields(supabase, user?.id ?? '', ['display_name', 'avatar_url']),
    getRoleContext(),
  ]);

  // No chosen role yet → onboarding, instead of relying on a minted profile.
  if (!currentRole) {
    return localizedRedirect(lang, '/onboarding/role');
  }

  // Gate by capability — never write active_role on render. A background
  // prefetch / multi-tab render must not be able to flip the user's role.
  // This is the photographer layout, so the view is photographer by definition.
  if (!heldRoles.includes('photographer')) {
    return localizedRedirect(lang, '/dashboard');
  }

  const activeRole = 'photographer';

  const sidebarUser = {
    name: profile?.display_name ?? user?.user_metadata?.full_name ?? user?.email ?? 'Member',
    email: user?.email ?? '',
    // Prefer the durable `profiles.avatar_url` (T-182) — auth metadata is
    // re-synced from Google on each OAuth sign-in and would revert an upload.
    avatar: profile?.avatar_url ?? user?.user_metadata?.avatar_url ?? null,
  };

  return (
    <SidebarProvider>
      <AppSidebar
        activeRole={activeRole}
        navLabels={{
          overview: dict.dashboard.overview,
          createEvent: dict.dashboard.createEvent,
          events: dict.dashboard.events,
          sales: dict.dashboard.sales,
          settings: dict.dashboard.settings,
          myPhotos: dict.dashboard.myPhotos,
          profile: dict.dashboard.profile,
          explore: dict.dashboard.explore,
          orders: dict.dashboard.orders,
        }}
      />
      <SidebarInset>
        <DashboardTopHeader user={sidebarUser} activeRole={activeRole} />
        <div className="flex flex-1 flex-col gap-6 px-3 py-4 pb-20 md:pb-4">{children}</div>
      </SidebarInset>
      <PhotographerBottomNav
        user={sidebarUser}
        activeRole={activeRole}
        navLabels={{
          overview: dict.dashboard.overview,
          createEvent: dict.dashboard.createEvent,
          events: dict.dashboard.events,
          sales: dict.dashboard.sales,
          activeRoleLabel: dict.dashboard.activeRole,
          roleLabel: dict.photographerDashboard.rolePhotographer,
          profile: dict.dashboard.profile,
          settings: dict.dashboard.settings,
          support: dict.dashboard.support,
          feedback: dict.dashboard.feedback,
          account: dict.dashboard.account,
          switchToTalent: `${dict.dashboard.switchTo} ${dict.talentDashboard.talentRole}`,
          logOut: dict.dashboard.logOut,
        }}
      />
    </SidebarProvider>
  );
}
