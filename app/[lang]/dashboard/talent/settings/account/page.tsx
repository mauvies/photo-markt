import { format } from 'date-fns';
import { Calendar, Mail, User } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { ROLES } from '@/lib/roles';
import { getProfileData } from '../actions';

export default async function TalentSettingsAccountPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const { profile, email, createdAt } = await getProfileData();

  if (!profile) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">{dict.talentDashboard.profileNotFound}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-4 text-lg font-semibold sm:text-xl">
        {dict.talentDashboard.accountInformation}
      </h2>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Mail className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{dict.talentDashboard.email}</p>
            <p className="text-sm font-medium truncate">{email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{dict.talentDashboard.memberSince}</p>
            <p className="text-sm font-medium">{format(new Date(createdAt), 'MMMM d, yyyy')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <User className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{dict.talentDashboard.role}</p>
            <p className="text-sm font-medium capitalize">
              {profile.active_role === ROLES.TALENT
                ? dict.talentDashboard.talentRole
                : dict.talentDashboard.photographerRole}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
