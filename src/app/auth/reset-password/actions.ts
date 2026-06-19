'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/database/server';

export async function updatePasswordAction(formData: FormData) {
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  if (!password || !confirmPassword) {
    return redirect('/auth/reset-password?message=Please fill in all fields');
  }

  if (password !== confirmPassword) {
    return redirect('/auth/reset-password?message=Passwords do not match');
  }

  // Server-side validation (fallback - client-side validation should catch this first)
  if (password.length < 8) {
    return redirect('/auth/reset-password?message=Password must be at least 8 characters');
  }

  // Check password complexity
  if (!/[A-Z]/.test(password)) {
    return redirect(
      '/auth/reset-password?message=Password must contain at least one uppercase letter',
    );
  }

  if (!/[a-z]/.test(password)) {
    return redirect(
      '/auth/reset-password?message=Password must contain at least one lowercase letter',
    );
  }

  if (!/[0-9]/.test(password)) {
    return redirect('/auth/reset-password?message=Password must contain at least one number');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return redirect(
      '/auth/reset-password?message=Password must contain at least one special character',
    );
  }

  const supabase = await createClient();

  // Check if user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect('/login?message=Session expired. Please request a new password reset link.');
  }

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    console.error(error);
    return redirect('/auth/reset-password?message=Could not update password. Please try again.');
  }

  return redirect(
    '/login?reset=success&message=Password updated successfully! You can now log in with your new password.',
  );
}
