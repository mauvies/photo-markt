import { redirect } from 'next/navigation';
import { CloseButton } from '@/components/close-button';
import { createClient } from '@/database/server';
import { ResetPasswordForm } from './reset-password-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; message?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // If there's a code, exchange it for a session
  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      return redirect('/login?message=Invalid or expired reset link. Please request a new one.');
    }
  }

  // Check if user is authenticated (should be after code exchange)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect('/login?message=Please request a new password reset link.');
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center p-6 md:p-8">
      <CloseButton className="absolute right-4 top-4" />
      <div className="w-full max-w-md">
        <h1 className="text-center text-4xl font-bold">Reset Password</h1>
        <p className="mt-4 text-center text-muted-foreground">Enter your new password below</p>

        {params?.message && (
          <div className="mt-4 rounded-lg border border-red-500 bg-red-50 p-4 text-center text-sm text-red-800 dark:bg-red-900/20 dark:text-red-400">
            {params.message}
          </div>
        )}

        <ResetPasswordForm />
      </div>
    </div>
  );
}
