import { getRoleContext } from '@/app/[lang]/actions/roles';
import { resolveDashboardHome } from '@/lib/auth/dashboard-home';
import { requireUser } from '@/lib/auth/require-user';
import { localizedRedirect } from '@/lib/i18n/redirect';

// Force dynamic rendering to ensure we always read fresh role data
export const dynamic = 'force-dynamic';

export default async function Dashboard({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;

  // Guard first: this page renders in parallel with `dashboard/layout.tsx`, so
  // its login redirect does not stop this one — an unauthenticated render would
  // otherwise reach `getRoleContext()`, which throws (T-198).
  await requireUser();

  // Resolve destination from the roles the user actually *holds*, not from
  // `active_role` alone. A stale `active_role` pointing at an unheld role would
  // otherwise loop with the role layout (which bounces unheld roles back here)
  // — the crash behind T-061.
  const { activeRole, heldRoles } = await getRoleContext();

  // No chosen role yet → onboarding, instead of minting a default profile.
  if (!activeRole) {
    localizedRedirect(lang, '/onboarding/role');
  }

  localizedRedirect(lang, resolveDashboardHome(activeRole, heldRoles));
}
