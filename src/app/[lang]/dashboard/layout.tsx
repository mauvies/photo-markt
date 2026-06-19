import { createClient } from '@/database/server';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToLogin();
  }

  return <>{children}</>;
}
