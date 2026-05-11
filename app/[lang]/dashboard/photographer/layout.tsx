import { getActiveRole, switchRole } from '@/app/[lang]/actions/roles';
import { AppSidebar } from '@/components/app-sidebar';
import { DashboardTopHeader } from '@/components/dashboard-top-header';
import { PhotographerBottomNav } from '@/components/photographer-bottom-nav';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getProfileFields } from '@/database/queries';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';

export default async function PhotographerLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLangFromHeaders();
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profile, { activeRole: currentRole }] = await Promise.all([
    getProfileFields(supabase, user?.id ?? '', ['display_name', 'active_role']),
    getActiveRole(),
  ]);

  let activeRole = currentRole;
  if (activeRole !== 'photographer') {
    await switchRole('photographer', { skipRevalidation: true });
    activeRole = 'photographer';
  }

  const sidebarUser = {
    name: profile?.display_name ?? user?.user_metadata?.full_name ?? user?.email ?? 'Member',
    email: user?.email ?? '',
    avatar: user?.user_metadata?.avatar_url ?? null,
  };

  return (
    <SidebarProvider>
      <AppSidebar
        activeRole={activeRole}
        navLabels={{
          overview: dict.dashboard.overview,
          createEvent: dict.dashboard.createEvent,
          events: dict.dashboard.events,
          revenue: dict.dashboard.revenue,
          myPhotos: dict.dashboard.myPhotos,
          profile: dict.dashboard.profile,
          explore: dict.dashboard.explore,
          orders: dict.dashboard.orders,
          support: dict.dashboard.support,
          feedback: dict.dashboard.feedback,
        }}
      />
      <SidebarInset>
        <DashboardTopHeader user={sidebarUser} activeRole={activeRole} />
        <div className="flex flex-1 flex-col gap-6 p-4 pb-20 md:pb-4">{children}</div>
      </SidebarInset>
      <PhotographerBottomNav
        user={sidebarUser}
        activeRole={activeRole}
        navLabels={{
          overview: dict.dashboard.overview,
          createEvent: dict.dashboard.createEvent,
          events: dict.dashboard.events,
          revenue: dict.dashboard.revenue,
          roleLabel: dict.photographerDashboard.rolePhotographer,
          profile: dict.dashboard.profile,
          settings: dict.dashboard.settings,
          billing: dict.dashboard.billing,
          payouts: dict.dashboard.payouts,
          support: dict.dashboard.support,
          feedback: dict.dashboard.feedback,
          account: dict.dashboard.account,
          switchToTalent: `${dict.dashboard.switchTo} Talent`,
          logOut: dict.dashboard.logOut,
        }}
      />
    </SidebarProvider>
  );
}
