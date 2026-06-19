import { DashboardHeader } from '@/components/dashboard-header';
import { type SettingsSection, SettingsShell } from '@/components/settings/settings-shell';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

export default async function TalentSettingsLayout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: React.ReactNode;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const base = `/${lang}/dashboard/talent/settings`;

  // No `icon:` field — the SettingsShell maps slug → lucide component on
  // the client side. Passing component references across the Server
  // Component boundary is unsupported by React.
  const sections: SettingsSection[] = [
    { slug: 'profile', label: dict.settings.tabs.profile, href: `${base}/profile` },
    { slug: 'account', label: dict.settings.tabs.account, href: `${base}/account` },
    { slug: 'language', label: dict.settings.tabs.language, href: `${base}/language` },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <DashboardHeader title={dict.settings.title} />
      <SettingsShell sections={sections}>{children}</SettingsShell>
    </div>
  );
}
