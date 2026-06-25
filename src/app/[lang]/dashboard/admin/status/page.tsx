import { notFound } from 'next/navigation';
import { DashboardHeader } from '@/components/dashboard-header';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';
import { getCachedReadinessReport } from '@/lib/health/probes';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

export const dynamic = 'force-dynamic';

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-green-500',
  down: 'bg-red-500',
  skipped: 'bg-muted-foreground/40',
};

/**
 * Admin-only service status dashboard (T-044). Runs the same readiness probes
 * as `/api/health/ready` directly (it's already admin-gated, so no token), and
 * paints a green/red/grey light per service. Server-rendered — reload to refresh.
 */
export default async function AdminStatusPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const t = dict.adminStatus;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectToLogin();

  // admin_users has no RLS policies — only the service role can read it.
  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!admin) notFound();

  // Cached (≤15s) so an admin refresh loop can't hammer the paid probes.
  const report = await getCachedReadinessReport();

  const overallLabel =
    report.status === 'ok'
      ? t.statusOk
      : report.status === 'degraded'
        ? t.statusDegraded
        : t.statusDown;
  const overallDot =
    report.status === 'ok'
      ? STATUS_DOT.ok
      : report.status === 'down'
        ? STATUS_DOT.down
        : 'bg-amber-500';

  const checkLabel = (status: string) =>
    status === 'ok' ? t.checkOk : status === 'down' ? t.checkDown : t.checkSkipped;

  return (
    <div>
      <DashboardHeader title={t.title} />
      <p className="mt-2 text-sm text-muted-foreground">{t.description}</p>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className={`h-3 w-3 shrink-0 rounded-full ${overallDot}`} aria-hidden />
        <div>
          <p className="font-semibold text-foreground">{overallLabel}</p>
          <p className="text-xs text-muted-foreground">
            {t.environment}: {report.environment}
          </p>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
        {report.checks.map((check) => (
          <li key={check.service} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[check.status] ?? STATUS_DOT.skipped}`}
                aria-hidden
              />
              <span className="font-medium text-foreground">{check.service}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{checkLabel(check.status)}</span>
              {check.status !== 'skipped' ? <span>{check.latencyMs} ms</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
