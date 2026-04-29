'use server';

import { cookies } from 'next/headers';
import { createClient } from '@/database/server';
import { getSiteUrl } from '@/lib/get-site-url';

export async function signInWithGoogle(plan?: string, next?: string) {
  const supabase = await createClient();
  const origin = getSiteUrl();

  // Store redirect state in a short-lived cookie instead of putting it in the
  // redirectTo URL. Supabase checks that redirectTo exactly matches a configured
  // allowed redirect URL — any query params in the URL break that check.
  const cookieStore = await cookies();
  const oauthState: Record<string, string> = {};
  if (plan) oauthState.plan = plan;
  if (next?.startsWith('/') && !next.startsWith('//')) oauthState.next = next;
  if (Object.keys(oauthState).length > 0) {
    cookieStore.set('oauth_redirect_state', JSON.stringify(oauthState), {
      maxAge: 60 * 10, // 10 minutes — enough to complete the OAuth flow
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) {
    console.error('Google OAuth error:', error);
    return {
      error: error.message,
      url: null,
    };
  }

  if (data.url) {
    return {
      error: null,
      url: data.url,
    };
  }

  return {
    error: 'Failed to initiate Google sign-in',
    url: null,
  };
}
