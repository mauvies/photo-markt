import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/database/server';
import { getSiteUrl } from '@/lib/get-site-url';

export async function POST(request: NextRequest) {
  // Reject cross-origin signout requests so a malicious site can't force the
  // user out of their session via a cross-origin POST/CSRF.
  const origin = request.headers.get('origin');
  const expected = getSiteUrl();
  if (origin && origin !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
