'use server';

import { createClient } from '@/database/server';
import { getBaseUrl } from '@/lib/get-base-url';

export async function resetPasswordAction(formData: FormData) {
  const email = formData.get('email') as string;

  if (!email) {
    throw new Error('Please enter your email address');
  }

  const supabase = await createClient();
  const baseUrl = await getBaseUrl();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${baseUrl}/auth/reset-password`,
  });

  if (error) {
    console.error(error);
    throw new Error(error.message || 'Could not send password reset email. Please try again.');
  }

  return { success: true };
}
