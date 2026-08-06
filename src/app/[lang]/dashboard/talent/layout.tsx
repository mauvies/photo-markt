import { getRoleContext } from '@/app/[lang]/actions/roles';
import { TalentDashboardHeader } from '@/components/talent-dashboard-header';
import { getProfileFields } from '@/database/queries';
import { createClient } from '@/database/server';
import { requireUser } from '@/lib/auth/require-user';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedRedirect } from '@/lib/i18n/redirect';

export default async function TalentLayout({ children }: { children: React.ReactNode }) {
  // Guard BEFORE any other work. Next renders this layout in parallel with its
  // parent, so `dashboard/layout.tsx`'s login redirect does not stop this one
  // from running: without this check, a signed-out (or momentarily
  // unauthenticated) render reached `getRoleContext()`, which throws a plain
  // Error, and that error raced the parent's redirect into the error boundary —
  // the intermittent error screen of T-198.
  const user = await requireUser();

  const lang = await getLangFromHeaders();
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();

  // Both the active-role preference and the set of held roles come from a
  // single auth round-trip via getRoleContext() (see T-095) instead of the
  // former getActiveRoleOrNull + userHasRole pair that re-authenticated twice.
  const [profile, { activeRole: currentRole, heldRoles }] = await Promise.all([
    getProfileFields(supabase, user.id, ['display_name', 'avatar_url']),
    getRoleContext(),
  ]);

  // No chosen role yet → onboarding, instead of relying on a minted profile.
  if (!currentRole) {
    return localizedRedirect(lang, '/onboarding/role');
  }

  // Gate by capability — never write active_role on render. A background
  // prefetch / multi-tab render must not be able to flip the user's role.
  // This is the talent layout, so the view is talent by definition.
  if (!heldRoles.includes('talent')) {
    return localizedRedirect(lang, '/dashboard');
  }

  const activeRole = 'talent';

  const sidebarUser = {
    name: profile?.display_name ?? user.user_metadata?.full_name ?? user.email ?? 'Member',
    email: user.email ?? '',
    // Prefer the durable `profiles.avatar_url` (T-182) — auth metadata is
    // re-synced from Google on each OAuth sign-in and would revert an upload.
    avatar: profile?.avatar_url ?? user.user_metadata?.avatar_url ?? null,
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
        heldRoles={heldRoles}
        navLabels={{
          explore: dict.nav.explore,
          myPhotos: dict.nav.favorites,
          orders: dict.nav.orders,
          profile: dict.nav.profile,
          privacy: dict.nav.privacy,
          settings: dict.dashboard.settings,
          support: dict.dashboard.support,
          feedback: dict.dashboard.feedback,
          activeRole: dict.dashboard.activeRole,
          switchTo: dict.dashboard.switchTo,
          becomePhotographer: dict.dashboard.becomePhotographer,
          becomeTalent: dict.dashboard.becomeTalent,
          roleActionFailed: dict.dashboard.roleActionFailed,
          roleActionNotSignedIn: dict.dashboard.roleActionNotSignedIn,
          logOut: dict.dashboard.logOut,
          rolePhotographer: dict.photographerDashboard.rolePhotographer,
          roleTalent: dict.talentDashboard.talentRole,
          account: dict.dashboard.account,
          cart: dict.nav.cart,
        }}
      />
      <div className="mx-auto w-full max-w-[1300px] flex flex-1 flex-col gap-6 pt-4 pb-20 px-4 sm:pt-6 sm:px-6 lg:px-8 ">
        {children}
      </div>
    </div>
  );
}
